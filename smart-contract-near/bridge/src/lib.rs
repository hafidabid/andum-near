//! Demo bridge on NEAR (ANDUM-PLAN §5.11). The relayer is TRUSTED; production would use NEAR Intents.
use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::{self, json};
use near_sdk::store::{LookupMap, LookupSet};
use near_sdk::{env, ext_contract, near, AccountId, Gas, PanicOnDefault, Promise, PromiseOrValue};

const GAS_MINT: Gas = Gas::from_tgas(30);
const GAS_MINT_CALL: Gas = Gas::from_tgas(100);
const GAS_CB: Gas = Gas::from_tgas(30);
pub const EVM_CHAINS: [&str; 2] = ["sepolia", "baseSepolia"];

#[ext_contract(ext_ft)]
pub trait ExtFt {
    fn ft_mint_privileged(&mut self, account_id: AccountId, amount: U128);
    fn ft_burn_privileged(&mut self, amount: U128);
    fn ft_mint_call(&mut self, receiver_id: AccountId, amount: U128, sender_override: AccountId, msg: String);
}
#[ext_contract(ext_self)]
pub trait ExtSelf {
    fn on_fund_resolved(&mut self, token_id: AccountId, near_receiver: AccountId, burned: U128);
    fn noop_true(&self) -> bool;
    fn zero(&self) -> U128;
}

fn err(code: &str) -> ! {
    env::panic_str(&format!("ANDUM_ERR:{code}"))
}
fn emit(event: &str, data: serde_json::Value) {
    env::log_str(&format!("EVENT_JSON:{}", json!({"standard":"andum-bridge","version":"1.0.0","event":event,"data":[data]})));
}

#[near(serializers=[json, borsh])]
#[derive(Clone)]
pub struct Outbound {
    pub nonce: u64,
    pub token_id: AccountId,
    pub from: AccountId,
    pub dest_chain: String,
    pub dest_address: String,
    pub amount: U128,
    pub ts: u64,
}

#[near(serializers=[json])]
pub struct OutMsg {
    pub dest_chain: String,
    pub dest_address: String,
}

#[near(serializers=[json])]
pub struct FundTarget {
    pub package_id: U64,
    pub part_id: u8,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner: AccountId,
    relayer: AccountId,
    core: AccountId,
    bridgeable: LookupSet<AccountId>,
    processed_in: LookupSet<String>,
    next_out_nonce: u64,
    outbound: LookupMap<u64, Outbound>,
    paused: bool,
}

#[near]
impl Contract {
    #[init]
    pub fn new(owner: AccountId, relayer: AccountId, core: AccountId, bridgeable_tokens: Vec<AccountId>) -> Self {
        let mut s = LookupSet::new(b"b");
        for t in bridgeable_tokens {
            s.insert(t);
        }
        Self { owner, relayer, core, bridgeable: s, processed_in: LookupSet::new(b"p"), next_out_nonce: 1, outbound: LookupMap::new(b"o"), paused: false }
    }

    pub fn set_paused(&mut self, paused: bool) {
        if env::predecessor_account_id() != self.owner {
            err("NOT_ADMIN");
        }
        self.paused = paused;
    }

    pub fn set_relayer(&mut self, relayer: AccountId) {
        if env::predecessor_account_id() != self.owner {
            err("NOT_ADMIN");
        }
        self.relayer = relayer;
    }

    pub fn set_bridgeable(&mut self, token_id: AccountId, enabled: bool) {
        if env::predecessor_account_id() != self.owner {
            err("NOT_ADMIN");
        }
        if enabled { self.bridgeable.insert(token_id); } else { self.bridgeable.remove(&token_id); }
    }

    /// Mint bridged tokens. Idempotent per (src_chain, src_nonce).
    pub fn bridge_in(&mut self, token_id: AccountId, near_receiver: AccountId, amount: U128, src_chain: String, src_nonce: U64, src_tx_hash: String, fund: Option<FundTarget>) -> PromiseOrValue<bool> {
        if env::predecessor_account_id() != self.relayer {
            err("BRIDGE_NOT_RELAYER");
        }
        if self.paused {
            err("PAUSED");
        }
        if !EVM_CHAINS.contains(&src_chain.as_str()) {
            err("BRIDGE_BAD_CHAIN");
        }
        if !self.bridgeable.contains(&token_id) {
            err("BRIDGE_ASSET_DISABLED");
        }
        if amount.0 == 0 {
            err("INVALID_AMOUNT");
        }
        let key = format!("{src_chain}:{}", src_nonce.0);
        if self.processed_in.contains(&key) {
            return PromiseOrValue::Value(false); // already processed: no effect
        }
        self.processed_in.insert(key);
        emit("bridge_in_done", json!({"token_id": token_id, "near_receiver": near_receiver, "amount": amount.0.to_string(), "src_chain": src_chain, "src_nonce": src_nonce.0.to_string(), "src_tx_hash": src_tx_hash, "fund": fund.as_ref().map(|f| json!({"package_id": f.package_id.0.to_string(), "part_id": f.part_id}))}));
        match fund {
            None => PromiseOrValue::Promise(
                ext_ft::ext(token_id).with_static_gas(GAS_MINT).ft_mint_privileged(near_receiver, amount).then(ext_self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(5)).noop_true()),
            ),
            Some(f) => {
                let msg = json!({"package_id": f.package_id.0.to_string(), "part_id": f.part_id}).to_string();
                PromiseOrValue::Promise(
                    ext_ft::ext(token_id.clone())
                        .with_static_gas(GAS_MINT_CALL)
                        .ft_mint_call(self.core.clone(), amount, near_receiver.clone(), msg)
                        .then(ext_self::ext(env::current_account_id()).with_static_gas(GAS_CB).on_fund_resolved(token_id, near_receiver, amount)),
                )
            }
        }
    }

    #[private]
    pub fn noop_true(&self) -> bool {
        true
    }

    /// After mint-and-fund, whatever the core did not keep was burned by the token; mint it back to the user.
    #[private]
    pub fn on_fund_resolved(&mut self, token_id: AccountId, near_receiver: AccountId, burned: U128) -> Promise {
        // `burned` is the amount originally minted; the token's own callback result tells how much was burned.
        let refund = match env::promise_result(0) {
            near_sdk::PromiseResult::Successful(v) => serde_json::from_slice::<U128>(&v).map(|u| u.0).unwrap_or(burned.0),
            _ => burned.0, // whole mint-call failed: nothing was funded, give the user their tokens
        };
        if refund == 0 {
            return Promise::new(env::current_account_id());
        }
        ext_ft::ext(token_id).with_static_gas(GAS_MINT).ft_mint_privileged(near_receiver, U128(refund))
    }

    /// NEP-141 receiver for outbound transfers: burn on NEAR, record for the EVM release.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        if self.paused {
            err("PAUSED");
        }
        let token = env::predecessor_account_id();
        if !self.bridgeable.contains(&token) {
            err("BRIDGE_ASSET_DISABLED");
        }
        if amount.0 == 0 {
            err("INVALID_AMOUNT");
        }
        let m: OutMsg = serde_json::from_str(&msg).unwrap_or_else(|_| err("BAD_MSG"));
        if !EVM_CHAINS.contains(&m.dest_chain.as_str()) {
            err("BRIDGE_BAD_CHAIN");
        }
        if !valid_evm_address(&m.dest_address) {
            err("BRIDGE_BAD_ADDRESS");
        }
        let nonce = self.next_out_nonce;
        self.next_out_nonce += 1;
        let o = Outbound { nonce, token_id: token.clone(), from: sender_id, dest_chain: m.dest_chain, dest_address: m.dest_address.to_lowercase(), amount, ts: env::block_timestamp() };
        emit("bridge_out", json!({"nonce": nonce.to_string(), "token_id": o.token_id, "from": o.from, "dest_chain": o.dest_chain, "dest_address": o.dest_address, "amount": amount.0.to_string()}));
        self.outbound.insert(nonce, o);
        // burn the tokens this contract just received
        PromiseOrValue::Promise(ext_ft::ext(token).with_static_gas(GAS_MINT).ft_burn_privileged(amount).then(ext_self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(5)).zero()))
    }

    #[private]
    pub fn zero(&self) -> U128 {
        U128(0)
    }

    pub fn get_outbound(&self, nonce: U64) -> Option<Outbound> {
        self.outbound.get(&nonce.0).cloned()
    }

    pub fn get_outbound_range(&self, from: U64, limit: u32) -> Vec<Outbound> {
        let start = from.0.max(1);
        let end = (start + limit.min(100) as u64).min(self.next_out_nonce);
        (start..end).filter_map(|n| self.outbound.get(&n).cloned()).collect()
    }

    pub fn next_out_nonce(&self) -> U64 {
        U64(self.next_out_nonce)
    }

    pub fn is_processed(&self, src_chain: String, src_nonce: U64) -> bool {
        self.processed_in.contains(&format!("{src_chain}:{}", src_nonce.0))
    }

    pub fn is_bridgeable(&self, token_id: AccountId) -> bool {
        self.bridgeable.contains(&token_id)
    }
}

pub fn valid_evm_address(a: &str) -> bool {
    a.len() == 42 && a.starts_with("0x") && a[2..].chars().all(|c| c.is_ascii_hexdigit()) && a[2..] != "0".repeat(40)
}

#[cfg(test)]
mod tests;
