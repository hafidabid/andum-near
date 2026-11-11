//! Mock NEP-141 token with a capped public faucet and a minter role for the demo bridge (ANDUM-PLAN §5.10).
use near_contract_standards::fungible_token::metadata::{FungibleTokenMetadata, FungibleTokenMetadataProvider, FT_METADATA_SPEC};
use near_contract_standards::fungible_token::FungibleToken;
use near_sdk::json_types::U128;
use near_sdk::store::LookupMap;
use near_sdk::{env, ext_contract, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseOrValue, PromiseResult};

const DAY_NS: u64 = 86_400_000_000_000;
const GAS_RECEIVER: Gas = Gas::from_tgas(40);
const GAS_RESOLVE: Gas = Gas::from_tgas(15);

#[ext_contract(ext_receiver)]
pub trait ExtReceiver {
    fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128>;
}
#[ext_contract(ext_self)]
pub trait ExtSelf {
    fn ft_mint_call_resolve(&mut self, receiver_id: AccountId, amount: U128) -> U128;
}

fn err(code: &str) -> ! {
    env::panic_str(&format!("ANDUM_ERR:{code}"))
}

#[near(serializers=[json])]
pub struct Caps {
    pub per_call: U128,
    pub daily: U128,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    token: FungibleToken,
    metadata: FungibleTokenMetadata,
    owner: AccountId,
    minters: Vec<AccountId>,
    per_call_cap: u128,
    daily_cap: u128,
    faucet_log: LookupMap<AccountId, Vec<(u64, u128)>>,
}

#[near]
impl Contract {
    #[init]
    pub fn new(owner_id: AccountId, name: String, symbol: String, decimals: u8, minters: Vec<AccountId>, per_call_cap: U128, daily_cap: U128) -> Self {
        require!(!env::state_exists(), "already initialised");
        require!(per_call_cap.0 <= daily_cap.0, "per_call cap must not exceed daily cap");
        let mut token = FungibleToken::new(b"a");
        token.internal_register_account(&owner_id);
        Self {
            token,
            metadata: FungibleTokenMetadata {
                spec: FT_METADATA_SPEC.to_string(),
                name,
                symbol,
                icon: None,
                reference: None,
                reference_hash: None,
                decimals,
            },
            owner: owner_id,
            minters,
            per_call_cap: per_call_cap.0,
            daily_cap: daily_cap.0,
            faucet_log: LookupMap::new(b"f"),
        }
    }

    fn assert_minter(&self) {
        let c = env::predecessor_account_id();
        if c != self.owner && !self.minters.contains(&c) {
            err("NOT_MINTER");
        }
    }

    fn mint_internal(&mut self, to: &AccountId, amount: u128) {
        if !self.token.accounts.contains_key(to) {
            self.token.internal_register_account(to);
        }
        self.token.internal_deposit(to, amount);
    }

    /// Public faucet: capped per call and per rolling 24 h per account.
    pub fn ft_mint(&mut self, account_id: AccountId, amount: U128) {
        let amount = amount.0;
        if amount == 0 {
            err("INVALID_AMOUNT");
        }
        if amount > self.per_call_cap {
            err("FAUCET_CAP_PER_CALL");
        }
        let now = env::block_timestamp();
        let mut log: Vec<(u64, u128)> = self.faucet_log.get(&account_id).cloned().unwrap_or_default();
        log.retain(|(t, _)| now.saturating_sub(*t) < DAY_NS);
        let used: u128 = log.iter().map(|(_, a)| *a).sum();
        if used.saturating_add(amount) > self.daily_cap {
            err("FAUCET_CAP_DAILY");
        }
        log.push((now, amount));
        self.faucet_log.insert(account_id.clone(), log);
        self.mint_internal(&account_id, amount);
    }

    pub fn ft_mint_privileged(&mut self, account_id: AccountId, amount: U128) {
        self.assert_minter();
        if amount.0 == 0 {
            err("INVALID_AMOUNT");
        }
        self.mint_internal(&account_id, amount.0);
    }

    /// Burns from the caller's own balance.
    pub fn ft_burn_privileged(&mut self, amount: U128) {
        self.assert_minter();
        let who = env::predecessor_account_id();
        self.token.internal_withdraw(&who, amount.0);
    }

    /// Mint to `receiver_id`, call its `ft_on_transfer`, burn whatever it reports unused. Returns burned amount.
    pub fn ft_mint_call(&mut self, receiver_id: AccountId, amount: U128, sender_override: AccountId, msg: String) -> Promise {
        self.assert_minter();
        if amount.0 == 0 {
            err("INVALID_AMOUNT");
        }
        self.mint_internal(&receiver_id, amount.0);
        ext_receiver::ext(receiver_id.clone())
            .with_static_gas(GAS_RECEIVER)
            .ft_on_transfer(sender_override, amount, msg)
            .then(ext_self::ext(env::current_account_id()).with_static_gas(GAS_RESOLVE).ft_mint_call_resolve(receiver_id, amount))
    }

    #[private]
    pub fn ft_mint_call_resolve(&mut self, receiver_id: AccountId, amount: U128) -> U128 {
        let unused = match env::promise_result(0) {
            PromiseResult::Successful(v) => near_sdk::serde_json::from_slice::<U128>(&v).map(|u| u.0.min(amount.0)).unwrap_or(amount.0),
            _ => amount.0,
        };
        self.resolve_unused(&receiver_id, unused)
    }

    pub fn get_caps(&self) -> Caps {
        Caps { per_call: U128(self.per_call_cap), daily: U128(self.daily_cap) }
    }

    pub fn faucet_remaining(&self, account_id: AccountId) -> U128 {
        let now = env::block_timestamp();
        let used: u128 = self.faucet_log.get(&account_id).map_or(0, |l| l.iter().filter(|(t, _)| now.saturating_sub(*t) < DAY_NS).map(|(_, a)| *a).sum());
        U128(self.daily_cap.saturating_sub(used))
    }

    pub fn get_minters(&self) -> Vec<AccountId> {
        self.minters.clone()
    }

    pub fn set_minters(&mut self, minters: Vec<AccountId>) {
        if env::predecessor_account_id() != self.owner {
            err("NOT_ADMIN");
        }
        self.minters = minters;
    }
}

impl Contract {
    /// Burn up to `unused` from the receiver's balance; returns amount actually burned.
    pub fn resolve_unused(&mut self, receiver_id: &AccountId, unused: u128) -> U128 {
        let bal = self.token.accounts.get(receiver_id).unwrap_or(0);
        let burn = unused.min(bal);
        if burn > 0 {
            self.token.internal_withdraw(receiver_id, burn);
        }
        U128(burn)
    }
}

near_contract_standards::impl_fungible_token_core!(Contract, token);

use near_contract_standards::storage_management::{StorageBalance, StorageBalanceBounds, StorageManagement};

#[near]
impl StorageManagement for Contract {
    #[payable]
    fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }
    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }
    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        // tokens are mock assets: burning on forced unregister keeps supply consistent
        #[allow(unused_variables)]
        let who = env::predecessor_account_id();
        let bal_before = self.token.accounts.get(&who).unwrap_or(0);
        match self.token.internal_storage_unregister(force) {
            Some((_, burned)) => {
                let _ = bal_before;
                let _ = burned;
                true
            }
            None => false,
        }
    }
    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }
    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenMetadataProvider for Contract {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        self.metadata.clone()
    }
}

#[cfg(test)]
mod tests;
