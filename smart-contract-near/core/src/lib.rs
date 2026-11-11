//! Andum core contract (ANDUM-PLAN §5): packages with parts that open on time and/or approval.
//! No method here lets the owner/admin move user funds (invariant I-1).
#![allow(clippy::too_many_arguments)]

pub mod errors;
pub mod events;
pub mod types;

#[cfg(test)]
mod tests;

use errors::*;
use events::{emit, emit_nft_mint};
use near_sdk::json_types::{Base64VecU8, U128, U64};
use near_sdk::serde_json::{self, json};
use near_sdk::store::{LookupMap, LookupSet, Vector};
use near_sdk::{
    env, ext_contract, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise,
    PromiseError, PromiseOrValue,
};
use types::*;

pub const GAS_CLAIM_CB: Gas = Gas::from_tgas(20);
pub const GAS_FT_TRANSFER: Gas = Gas::from_tgas(30);
pub const GAS_STORAGE_DEPOSIT: Gas = Gas::from_tgas(15);
/// Paid by the contract balance to register a receiver with a token (NEP-145 min is ~0.00125).
pub const STORAGE_DEPOSIT: NearToken = NearToken::from_yoctonear(2_500_000_000_000_000_000_000);
const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);

#[ext_contract(ext_ft)]
pub trait ExtFt {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
    fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>);
}

#[ext_contract(ext_self)]
pub trait ExtSelf {
    fn on_claim_resolved(&mut self, package_id: U64, part_id: u8, attempt_id: U64);
    fn on_reclaim_resolved(&mut self, package_id: U64, part_id: u8, amount: U128);
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner: AccountId,
    paused: bool,
    allowed_tokens: LookupSet<AccountId>,
    allowed_list: Vec<AccountId>,
    limits: Limits,
    next_package_id: u64,
    package_count: u64,
    packages: LookupMap<u64, Package>,
    by_sender: LookupMap<AccountId, Vector<u64>>,
    // NFT (NEP-171/181): token_id == package_id
    nft_all: Vector<u64>,
    nft_by_owner: LookupMap<AccountId, Vector<u64>>,
    open_count: LookupMap<AccountId, u32>,
}

fn now() -> u64 {
    env::block_timestamp()
}

#[near]
impl Contract {
    // ------------------------------------------------------------------ init / admin
    #[init]
    pub fn new(owner: AccountId, allowed_tokens: Vec<AccountId>, limits: Option<Limits>) -> Self {
        require!(!env::state_exists(), "already initialised");
        let mut set = LookupSet::new(b"t");
        for t in &allowed_tokens {
            set.insert(t.clone());
        }
        Self {
            owner,
            paused: false,
            allowed_tokens: set,
            allowed_list: dedup(allowed_tokens),
            limits: limits.unwrap_or_default(),
            next_package_id: 1,
            package_count: 0,
            packages: LookupMap::new(b"p"),
            by_sender: LookupMap::new(b"s"),
            nft_all: Vector::new(b"n"),
            nft_by_owner: LookupMap::new(b"o"),
            open_count: LookupMap::new(b"c"),
        }
    }

    fn assert_admin(&self) {
        if env::predecessor_account_id() != self.owner {
            err(NOT_ADMIN);
        }
    }
    fn assert_not_paused(&self) {
        if self.paused {
            err(PAUSED);
        }
    }

    pub fn set_paused(&mut self, paused: bool) {
        self.assert_admin();
        self.paused = paused;
        emit("paused_changed", json!({ "paused": paused }));
    }

    pub fn set_allowed_tokens(&mut self, tokens: Vec<AccountId>) {
        self.assert_admin();
        for t in &self.allowed_list {
            self.allowed_tokens.remove(t);
        }
        for t in &tokens {
            self.allowed_tokens.insert(t.clone());
        }
        self.allowed_list = dedup(tokens);
    }

    pub fn set_limits(&mut self, limits: Limits) {
        self.assert_admin();
        require!(limits.max_parts >= 1 && limits.max_parts <= 8, "max_parts out of range");
        require!(limits.max_approvers >= 1 && limits.max_approvers <= 5, "max_approvers out of range");
        require!(limits.max_accept_window_days >= 1, "window must be positive");
        self.limits = limits;
    }

    /// Adds NEAR to the contract balance (storage reserve). Cannot be withdrawn: there is no withdraw method.
    #[payable]
    pub fn top_up(&mut self) {
        self.assert_admin();
    }

    #[private]
    #[init(ignore_state)]
    pub fn migrate() -> Self {
        env::state_read().unwrap_or_else(|| env::panic_str("no state to migrate"))
    }

    // ------------------------------------------------------------------ create
    pub fn create_package(&mut self, args: CreatePackageArgs) -> U64 {
        self.assert_not_paused();
        let sender = env::predecessor_account_id();
        let t = now();
        let CreatePackageArgs { parts, accept_by_ns, recipient, invite_hash, note, theme } = args;

        if parts.is_empty() || parts.len() > self.limits.max_parts as usize {
            err(INVALID_PARTS);
        }
        for p in &parts {
            if !self.allowed_tokens.contains(&p.token) {
                err(TOKEN_NOT_ALLOWED);
            }
        }
        for p in &parts {
            if p.amount.0 == 0 {
                err(INVALID_AMOUNT);
            }
        }
        for p in &parts {
            let has_approvers = p.approvers.as_ref().map_or(false, |a| !a.is_empty());
            if (has_approvers || p.approval_threshold.is_some()) && p.unlock_ns.is_none() {
                err(INVALID_RULE);
            }
        }
        for p in &parts {
            let approvers = p.approvers.clone().unwrap_or_default();
            if p.approvers.is_none() && p.approval_threshold.is_none() {
                continue;
            }
            if approvers.is_empty() || approvers.len() > self.limits.max_approvers as usize {
                err(INVALID_APPROVERS);
            }
            let mut sorted = approvers.clone();
            sorted.sort();
            sorted.dedup();
            if sorted.len() != approvers.len() {
                err(INVALID_APPROVERS);
            }
            let th = p.approval_threshold.unwrap_or(1);
            if th < 1 || th as usize > approvers.len() {
                err(INVALID_APPROVERS);
            }
            if let Some(r) = &recipient {
                if approvers.contains(r) {
                    err(INVALID_APPROVERS);
                }
            }
        }
        let theme = theme.unwrap_or_else(|| "none".to_string());
        if !THEMES.contains(&theme.as_str()) {
            err(INVALID_THEME);
        }
        for p in &parts {
            if let Some(u) = p.unlock_ns {
                if u.0 <= t {
                    err(UNLOCK_IN_PAST);
                }
            }
        }
        let window = self.limits.max_accept_window_days as u64 * NS_PER_DAY;
        if accept_by_ns.0 <= t || accept_by_ns.0 > t + window {
            err(INVALID_EXPIRY);
        }
        if let Some(n) = &note {
            if n.chars().count() > self.limits.max_note as usize {
                err(NOTE_TOO_LONG);
            }
        }
        if recipient.is_some() == invite_hash.is_some() {
            env::log_str("exactly one of recipient or invite_hash is required");
            err(INVALID_PARTS);
        }
        let invite_hash: Option<[u8; 32]> = invite_hash.map(|h| {
            let v: Vec<u8> = h.into();
            if v.len() != 32 {
                env::log_str("invite_hash must be 32 bytes");
                err(INVALID_PARTS);
            }
            let mut a = [0u8; 32];
            a.copy_from_slice(&v);
            a
        });
        if self.open_count.get(&sender).copied().unwrap_or(0) >= self.limits.max_open_per_sender {
            err(LIMIT_EXCEEDED);
        }
        let need = (800u128 + 300 * parts.len() as u128) * env::storage_byte_cost().as_yoctonear();
        if self.storage_available() < need {
            err(STORAGE_RESERVE_LOW);
        }

        let id = self.next_package_id;
        self.next_package_id += 1;
        self.package_count += 1;
        let parts: Vec<Part> = parts
            .into_iter()
            .map(|p| {
                let approvers = p.approvers.unwrap_or_default();
                let threshold = if approvers.is_empty() { 0 } else { p.approval_threshold.unwrap_or(1) };
                Part {
                    token: p.token,
                    amount: p.amount.0,
                    funded: 0,
                    unlock_ns: p.unlock_ns.map(|u| u.0),
                    approvers,
                    threshold,
                    approvals: vec![],
                    state: PartState::Locked,
                    attempts: 0,
                    reclaimed: 0,
                }
            })
            .collect();
        let ev_parts: Vec<_> = parts
            .iter()
            .enumerate()
            .map(|(i, p)| {
                json!({"part_id": i, "token": p.token, "amount": p.amount.to_string(),
                    "unlock_ns": p.unlock_ns.map(|u| u.to_string()), "approvers": p.approvers, "threshold": p.threshold})
            })
            .collect();
        emit(
            "package_created",
            json!({"package_id": id.to_string(), "sender": sender, "parts": ev_parts,
                "accept_by_ns": accept_by_ns.0.to_string(), "recipient": recipient, "note": note, "theme": theme}),
        );
        let pkg = Package {
            id,
            sender: sender.clone(),
            recipient,
            owner: None,
            invite_hash,
            accept_by_ns: accept_by_ns.0,
            created_ns: t,
            accepted_ns: None,
            status: PackageStatus::AwaitingFunds,
            note,
            theme,
            parts,
        };
        self.packages.insert(id, pkg);
        if self.by_sender.get(&sender).is_none() {
            let mut key = b"S".to_vec();
            key.extend_from_slice(sender.as_bytes());
            self.by_sender.insert(sender.clone(), Vector::new(key));
        }
        self.by_sender.get_mut(&sender).unwrap().push(id);
        let c = self.open_count.get(&sender).copied().unwrap_or(0);
        self.open_count.insert(sender, c + 1);
        U64(id)
    }

    // ------------------------------------------------------------------ funding
    /// NEP-141 receiver. Panicking makes the token refund everything.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        self.assert_not_paused();
        let token = env::predecessor_account_id();
        let m: FundMsg = serde_json::from_str(&msg).unwrap_or_else(|_| err(BAD_MSG));
        let mut pkg = self.packages.get(&m.package_id.0).cloned().unwrap_or_else(|| err(PACKAGE_NOT_FOUND));
        if pkg.status != PackageStatus::AwaitingFunds {
            err(PACKAGE_NOT_ACTIVE);
        }
        let idx = m.part_id as usize;
        if idx >= pkg.parts.len() {
            err(PART_NOT_FOUND);
        }
        if pkg.parts[idx].token != token {
            err(WRONG_TOKEN);
        }
        if sender_id != pkg.sender {
            err(WRONG_SENDER);
        }
        let part = &mut pkg.parts[idx];
        let remaining = part.amount - part.funded;
        let accepted = amount.0.min(remaining);
        part.funded += accepted;
        let unused = amount.0 - accepted;
        let funded_total = part.funded;
        let (ptoken, pamount) = (part.token.clone(), part.amount);
        let id = pkg.id;
        if unused > 0 {
            emit("deposit_refunded", json!({"package_id": id.to_string(), "part_id": idx, "token": ptoken, "amount": unused.to_string()}));
        }
        if accepted > 0 {
            emit("part_funded", json!({"package_id": id.to_string(), "part_id": idx, "token": ptoken, "amount": accepted.to_string(), "funded_total": funded_total.to_string()}));
        }
        let _ = pamount;
        if pkg.parts.iter().all(|p| p.funded == p.amount) {
            pkg.status = PackageStatus::Funded;
            emit("package_funded", json!({"package_id": id.to_string()}));
        }
        self.packages.insert(id, pkg);
        PromiseOrValue::Value(U128(unused))
    }

    // ------------------------------------------------------------------ accept
    pub fn accept_package(&mut self, package_id: U64, invite_secret: Option<Base64VecU8>) {
        self.assert_not_paused();
        let caller = env::predecessor_account_id();
        let mut pkg = self.get_pkg(package_id.0);
        match pkg.status {
            PackageStatus::Accepted => err(ALREADY_ACCEPTED),
            PackageStatus::Funded => {}
            _ => err(PACKAGE_NOT_ACTIVE),
        }
        if now() > pkg.accept_by_ns {
            err(INVITE_EXPIRED);
        }
        if let Some(r) = &pkg.recipient {
            if &caller != r {
                err(NOT_INVITED_ACCOUNT);
            }
        } else {
            let secret: Vec<u8> = invite_secret.map(Into::into).unwrap_or_else(|| err(INVITE_SECRET_INVALID));
            let h = env::sha256_array(&secret);
            if Some(h) != pkg.invite_hash {
                err(INVITE_SECRET_INVALID);
            }
        }
        if pkg.parts.iter().any(|p| p.approvers.contains(&caller)) {
            err(RECEIVER_IS_APPROVER);
        }
        pkg.owner = Some(caller.clone());
        pkg.accepted_ns = Some(now());
        pkg.status = PackageStatus::Accepted;
        // NFT
        self.nft_all.push(pkg.id);
        if self.nft_by_owner.get(&caller).is_none() {
            let mut key = b"O".to_vec();
            key.extend_from_slice(caller.as_bytes());
            self.nft_by_owner.insert(caller.clone(), Vector::new(key));
        }
        self.nft_by_owner.get_mut(&caller).unwrap().push(pkg.id);
        emit_nft_mint(caller.as_str(), &pkg.id.to_string());
        // register receiver with each distinct token, paid by this contract (fire and forget)
        let mut tokens: Vec<AccountId> = pkg.parts.iter().map(|p| p.token.clone()).collect();
        tokens.sort();
        tokens.dedup();
        for t in tokens {
            let _ = ext_ft::ext(t)
                .with_attached_deposit(STORAGE_DEPOSIT)
                .with_static_gas(GAS_STORAGE_DEPOSIT)
                .storage_deposit(Some(caller.clone()), Some(true));
        }
        emit("package_accepted", json!({"package_id": pkg.id.to_string(), "owner": caller}));
        self.packages.insert(pkg.id, pkg);
    }

    // ------------------------------------------------------------------ approve
    pub fn approve_part(&mut self, package_id: U64, part_id: u8) {
        self.assert_not_paused();
        let caller = env::predecessor_account_id();
        let mut pkg = self.get_pkg(package_id.0);
        if pkg.status != PackageStatus::Funded && pkg.status != PackageStatus::Accepted {
            err(PACKAGE_NOT_ACTIVE);
        }
        let part = pkg.parts.get_mut(part_id as usize).unwrap_or_else(|| err(PART_NOT_FOUND));
        if !part.approvers.contains(&caller) {
            err(NOT_APPROVER);
        }
        if part.approvals.contains(&caller) {
            return; // idempotent no-op
        }
        let before = part.approvals.len();
        part.approvals.push(caller.clone());
        let count = part.approvals.len();
        let met = before < part.threshold as usize && count >= part.threshold as usize;
        emit(
            "part_approved",
            json!({"package_id": pkg.id.to_string(), "part_id": part_id, "approver": caller,
                "approvals": count, "threshold": part.threshold, "threshold_met": met}),
        );
        self.packages.insert(pkg.id, pkg);
    }

    // ------------------------------------------------------------------ claim
    pub fn claim(&mut self, package_id: U64, part_id: u8) -> Promise {
        self.assert_not_paused();
        let caller = env::predecessor_account_id();
        let mut pkg = self.get_pkg(package_id.0);
        if pkg.status != PackageStatus::Accepted {
            err(PACKAGE_NOT_ACTIVE);
        }
        if pkg.owner.as_ref() != Some(&caller) {
            err(NOT_PASS_OWNER);
        }
        let part = pkg.parts.get_mut(part_id as usize).unwrap_or_else(|| err(PART_NOT_FOUND));
        match part.state {
            PartState::Taken { .. } => err(ALREADY_TAKEN),
            PartState::Pending { .. } => err(TRANSFER_PENDING),
            PartState::Locked => {}
        }
        if let Some(u) = part.unlock_ns {
            if now() < u {
                err(TIME_NOT_REACHED);
            }
        }
        if !part.approvers.is_empty() && part.approvals.len() < part.threshold as usize {
            err(APPROVAL_MISSING);
        }
        part.attempts += 1;
        let attempt = part.attempts;
        part.state = PartState::Pending { attempt_id: attempt };
        let (token, amount) = (part.token.clone(), part.amount);
        emit("claim_started", json!({"package_id": pkg.id.to_string(), "part_id": part_id, "attempt_id": attempt.to_string(), "owner": caller}));
        self.packages.insert(pkg.id, pkg);
        ext_ft::ext(token.clone())
            .with_attached_deposit(STORAGE_DEPOSIT)
            .with_static_gas(GAS_STORAGE_DEPOSIT)
            .storage_deposit(Some(caller.clone()), Some(true))
            .then(
                ext_ft::ext(token)
                    .with_attached_deposit(ONE_YOCTO)
                    .with_static_gas(GAS_FT_TRANSFER)
                    .ft_transfer(caller, U128(amount), Some(format!("andum:{}:{}", package_id.0, part_id))),
            )
            .then(
                ext_self::ext(env::current_account_id())
                    .with_static_gas(GAS_CLAIM_CB)
                    .on_claim_resolved(package_id, part_id, U64(attempt)),
            )
    }

    #[private]
    pub fn on_claim_resolved(
        &mut self,
        package_id: U64,
        part_id: u8,
        attempt_id: U64,
        #[callback_result] result: Result<(), PromiseError>,
    ) {
        self.resolve_claim(package_id.0, part_id, attempt_id.0, result.is_ok());
    }

    // ------------------------------------------------------------------ reclaim
    pub fn reclaim_unaccepted(&mut self, package_id: U64) {
        // intentionally allowed while paused so senders are never trapped
        let caller = env::predecessor_account_id();
        let mut pkg = self.get_pkg(package_id.0);
        if pkg.sender != caller {
            err(NOT_SENDER);
        }
        let first = pkg.status != PackageStatus::Reclaimed;
        match pkg.status {
            PackageStatus::Accepted => err(NOT_RECLAIMABLE),
            PackageStatus::AwaitingFunds => {}
            PackageStatus::Funded => {
                if now() <= pkg.accept_by_ns {
                    err(NOT_RECLAIMABLE);
                }
            }
            PackageStatus::Reclaimed => {}
        }
        let refundable_total: u128 = pkg.parts.iter().map(|p| p.funded - p.reclaimed).sum();
        if !first && refundable_total == 0 {
            err(ALREADY_RECLAIMED);
        }
        pkg.status = PackageStatus::Reclaimed;
        let mut returned = vec![];
        let mut chain: Option<Promise> = None;
        for (i, p) in pkg.parts.iter_mut().enumerate() {
            let amt = p.funded - p.reclaimed;
            if amt == 0 {
                continue;
            }
            p.reclaimed += amt;
            returned.push(json!({"token": p.token, "amount": amt.to_string()}));
            let pr = ext_ft::ext(p.token.clone())
                .with_attached_deposit(ONE_YOCTO)
                .with_static_gas(GAS_FT_TRANSFER)
                .ft_transfer(caller.clone(), U128(amt), Some(format!("andum:reclaim:{}", pkg.id)))
                .then(
                    ext_self::ext(env::current_account_id())
                        .with_static_gas(GAS_CLAIM_CB)
                        .on_reclaim_resolved(package_id, i as u8, U128(amt)),
                );
            chain = Some(match chain {
                Some(c) => c.and(pr),
                None => pr,
            });
        }
        if first {
            self.dec_open(&caller);
        }
        emit("package_reclaimed", json!({"package_id": pkg.id.to_string(), "sender": caller, "returned": returned}));
        self.packages.insert(pkg.id, pkg);
        let _ = chain; // promises are scheduled when created
    }

    #[private]
    pub fn on_reclaim_resolved(
        &mut self,
        package_id: U64,
        part_id: u8,
        amount: U128,
        #[callback_result] result: Result<(), PromiseError>,
    ) {
        self.resolve_reclaim(package_id.0, part_id, amount.0, result.is_ok());
    }

    // ------------------------------------------------------------------ views
    pub fn get_package(&self, package_id: U64) -> Option<PackageView> {
        self.packages.get(&package_id.0).map(|p| self.to_view(p))
    }

    pub fn get_packages_by_sender(&self, account_id: AccountId, from: Option<U64>, limit: Option<u32>) -> Vec<PackageView> {
        let ids = match self.by_sender.get(&account_id) {
            Some(v) => v,
            None => return vec![],
        };
        self.page(ids, from, limit)
    }

    pub fn get_packages_by_owner(&self, account_id: AccountId, from: Option<U64>, limit: Option<u32>) -> Vec<PackageView> {
        let ids = match self.nft_by_owner.get(&account_id) {
            Some(v) => v,
            None => return vec![],
        };
        self.page(ids, from, limit)
    }

    pub fn get_config(&self) -> near_sdk::serde_json::Value {
        json!({"owner": self.owner, "paused": self.paused, "allowed_tokens": self.allowed_list, "limits": self.limits,
               "next_package_id": self.next_package_id.to_string()})
    }

    pub fn storage_report(&self) -> StorageReport {
        let balance = env::account_balance().as_yoctonear();
        let locked = env::storage_usage() as u128 * env::storage_byte_cost().as_yoctonear();
        StorageReport {
            balance: U128(balance),
            locked_for_storage: U128(locked),
            available: U128(balance.saturating_sub(locked)),
            packages: U64(self.package_count),
            bytes_used: U64(env::storage_usage()),
        }
    }

    // ------------------------------------------------------------------ NFT (NEP-171/177/181)
    pub fn nft_metadata(&self) -> NFTContractMetadata {
        NFTContractMetadata {
            spec: "nft-1.0.0".into(),
            name: "Andum package pass".into(),
            symbol: "ANDUM".into(),
            icon: None,
            base_uri: None,
            reference: None,
            reference_hash: None,
        }
    }

    pub fn nft_token(&self, token_id: String) -> Option<JsonToken> {
        let id: u64 = token_id.parse().ok()?;
        let p = self.packages.get(&id)?;
        let owner = p.owner.clone()?;
        Some(self.json_token(p, owner))
    }

    pub fn nft_total_supply(&self) -> U128 {
        U128(self.nft_all.len() as u128)
    }

    pub fn nft_tokens(&self, from_index: Option<U128>, limit: Option<u64>) -> Vec<JsonToken> {
        let from = from_index.map_or(0, |f| f.0 as u32);
        let lim = limit.unwrap_or(50).min(100) as u32;
        (from..self.nft_all.len().min(from.saturating_add(lim)))
            .filter_map(|i| self.nft_token(self.nft_all[i].to_string()))
            .collect()
    }

    pub fn nft_supply_for_owner(&self, account_id: AccountId) -> U128 {
        U128(self.nft_by_owner.get(&account_id).map_or(0, |v| v.len()) as u128)
    }

    pub fn nft_tokens_for_owner(&self, account_id: AccountId, from_index: Option<U128>, limit: Option<u64>) -> Vec<JsonToken> {
        let v = match self.nft_by_owner.get(&account_id) {
            Some(v) => v,
            None => return vec![],
        };
        let from = from_index.map_or(0, |f| f.0 as u32);
        let lim = limit.unwrap_or(50).min(100) as u32;
        (from..v.len().min(from.saturating_add(lim)))
            .filter_map(|i| self.nft_token(v[i].to_string()))
            .collect()
    }

    /// Passes are non-transferable. Always panics.
    #[payable]
    pub fn nft_transfer(&mut self, receiver_id: AccountId, token_id: String, approval_id: Option<u64>, memo: Option<String>) {
        let _ = (receiver_id, token_id, approval_id, memo);
        err(PASS_NOT_TRANSFERABLE)
    }

    #[payable]
    pub fn nft_transfer_call(&mut self, receiver_id: AccountId, token_id: String, approval_id: Option<u64>, memo: Option<String>, msg: String) {
        let _ = (receiver_id, token_id, approval_id, memo, msg);
        err(PASS_NOT_TRANSFERABLE)
    }
}

// ---------------------------------------------------------------------- internals
impl Contract {
    fn get_pkg(&self, id: u64) -> Package {
        self.packages.get(&id).cloned().unwrap_or_else(|| err(PACKAGE_NOT_FOUND))
    }

    fn storage_available(&self) -> u128 {
        let balance = env::account_balance().as_yoctonear();
        let locked = env::storage_usage() as u128 * env::storage_byte_cost().as_yoctonear();
        balance.saturating_sub(locked)
    }

    fn dec_open(&mut self, who: &AccountId) {
        let c = self.open_count.get(who).copied().unwrap_or(0);
        self.open_count.insert(who.clone(), c.saturating_sub(1));
    }

    /// The only place a part becomes `Taken` (I-3).
    pub fn resolve_claim(&mut self, package_id: u64, part_id: u8, attempt_id: u64, success: bool) {
        let mut pkg = match self.packages.get(&package_id) {
            Some(p) => p.clone(),
            None => return,
        };
        let owner = pkg.owner.clone();
        let part = match pkg.parts.get_mut(part_id as usize) {
            Some(p) => p,
            None => return,
        };
        match part.state {
            PartState::Pending { attempt_id: a } if a == attempt_id => {}
            _ => return, // stale or unrelated callback
        }
        let (token, amount) = (part.token.clone(), part.amount);
        if success {
            part.state = PartState::Taken { taken_ns: now() };
            emit("part_claimed", json!({"package_id": package_id.to_string(), "part_id": part_id, "owner": owner, "token": token, "amount": amount.to_string()}));
            if pkg.parts.iter().all(|p| matches!(p.state, PartState::Taken { .. })) {
                let sender = pkg.sender.clone();
                self.dec_open(&sender);
            }
        } else {
            part.state = PartState::Locked;
            emit("claim_failed", json!({"package_id": package_id.to_string(), "part_id": part_id, "attempt_id": attempt_id.to_string()}));
        }
        self.packages.insert(package_id, pkg);
    }

    pub fn resolve_reclaim(&mut self, package_id: u64, part_id: u8, amount: u128, success: bool) {
        if success {
            return;
        }
        if let Some(pkg) = self.packages.get_mut(&package_id) {
            if let Some(p) = pkg.parts.get_mut(part_id as usize) {
                p.reclaimed = p.reclaimed.saturating_sub(amount);
            }
        }
    }

    fn page(&self, ids: &Vector<u64>, from: Option<U64>, limit: Option<u32>) -> Vec<PackageView> {
        let from = from.map_or(0, |f| f.0);
        let lim = limit.unwrap_or(20).min(50) as usize;
        ids.iter()
            .filter(|id| **id >= from)
            .take(lim)
            .filter_map(|id| self.packages.get(id).map(|p| self.to_view(p)))
            .collect()
    }

    fn json_token(&self, p: &Package, owner: AccountId) -> JsonToken {
        JsonToken {
            token_id: p.id.to_string(),
            owner_id: owner,
            metadata: TokenMetadata {
                title: Some(format!("Andum package #{}", p.id)),
                description: p.note.clone(),
                media: None, // backend serves <API_BASE>/v1/packages/<id>/nft.svg
                copies: Some(1),
                reference: None,
            },
        }
    }

    pub fn to_view(&self, p: &Package) -> PackageView {
        let accepted = p.status == PackageStatus::Accepted;
        let t = now();
        let parts = p
            .parts
            .iter()
            .enumerate()
            .map(|(i, part)| {
                let approved = !part.approvers.is_empty() && part.approvals.len() >= part.threshold as usize;
                let no_rule_approval = part.approvers.is_empty();
                let date_ok = part.unlock_ns.map_or(true, |u| t >= u);
                let appr_ok = no_rule_approval || approved;
                let (state, taken_ns) = match part.state {
                    PartState::Locked => (PartViewState::LOCKED, None),
                    PartState::Pending { .. } => (PartViewState::PENDING, None),
                    PartState::Taken { taken_ns } => (PartViewState::TAKEN, Some(U64(taken_ns))),
                };
                let (status, reason): (&str, Option<&str>) = match part.state {
                    PartState::Taken { .. } => ("TAKEN", None),
                    _ if !accepted => ("NOT_ACCEPTED", Some(PACKAGE_NOT_ACTIVE)),
                    PartState::Pending { .. } => ("PROCESSING", None),
                    _ if date_ok && appr_ok => ("OPEN", None),
                    _ if !date_ok && !appr_ok => ("WAITING_DATE_AND_APPROVAL", Some(TIME_NOT_REACHED)),
                    _ if !date_ok => ("WAITING_DATE", Some(TIME_NOT_REACHED)),
                    _ => ("WAITING_APPROVAL", Some(APPROVAL_MISSING)),
                };
                PartView {
                    part_id: i as u8,
                    token: part.token.clone(),
                    amount: U128(part.amount),
                    funded: U128(part.funded),
                    unlock_ns: part.unlock_ns.map(U64),
                    approvers: part.approvers.clone(),
                    threshold: part.threshold,
                    approvals: part.approvals.clone(),
                    approved,
                    state,
                    status: status.to_string(),
                    reason: reason.map(String::from),
                    taken_ns,
                }
            })
            .collect();
        PackageView {
            id: U64(p.id),
            sender: p.sender.clone(),
            recipient: p.recipient.clone(),
            owner: p.owner.clone(),
            invite_hash: p.invite_hash.map(|h| Base64VecU8::from(h.to_vec())),
            status: p.status,
            note: p.note.clone(),
            theme: p.theme.clone(),
            accept_by_ns: U64(p.accept_by_ns),
            created_ns: U64(p.created_ns),
            accepted_ns: p.accepted_ns.map(U64),
            parts,
        }
    }
}

fn dedup(mut v: Vec<AccountId>) -> Vec<AccountId> {
    v.sort();
    v.dedup();
    v
}
