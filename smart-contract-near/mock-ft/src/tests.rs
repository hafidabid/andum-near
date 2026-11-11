use super::*;
use near_contract_standards::fungible_token::FungibleTokenCore;
use near_contract_standards::storage_management::StorageManagement;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::testing_env;
use std::panic::{catch_unwind, AssertUnwindSafe};

const T0: u64 = 1_000_000_000_000_000_000;
fn acc(s: &str) -> AccountId { s.parse().unwrap() }
fn ctx(who: &str, ts: u64) {
    testing_env!(VMContextBuilder::new().predecessor_account_id(acc(who)).current_account_id(acc("usdc.andum.testnet")).block_timestamp(ts).attached_deposit(NearToken::from_yoctonear(0)).build());
}
fn new_ft() -> Contract {
    ctx("admin.testnet", T0);
    Contract::new(acc("admin.testnet"), "USD".into(), "USDC".into(), 6, vec![acc("bridge.testnet")], U128(10_000), U128(25_000))
}
fn expect_err<R>(code: &str, f: impl FnOnce() -> R) {
    match catch_unwind(AssertUnwindSafe(f)) {
        Ok(_) => panic!("expected {code}"),
        Err(e) => {
            let m = e.downcast_ref::<String>().cloned().or_else(|| e.downcast_ref::<&str>().map(|s| s.to_string())).unwrap_or_default();
            assert!(m.contains(&format!("ANDUM_ERR:{code}")), "got {m}");
        }
    }
}
fn bal(c: &Contract, a: &str) -> u128 { c.ft_balance_of(acc(a)).0 }

#[test] fn faucet_mints_and_registers() {
    let mut c = new_ft();
    ctx("rina.testnet", T0);
    c.ft_mint(acc("rina.testnet"), U128(5_000));
    assert_eq!(bal(&c, "rina.testnet"), 5_000);
    assert_eq!(c.ft_total_supply().0, 5_000);
}
#[test] fn faucet_per_call_cap_boundary() {
    let mut c = new_ft();
    c.ft_mint(acc("a.testnet"), U128(10_000)); // exactly the cap
    expect_err("FAUCET_CAP_PER_CALL", || c.ft_mint(acc("b.testnet"), U128(10_001)));
}
#[test] fn faucet_zero_rejected() {
    let mut c = new_ft();
    expect_err("INVALID_AMOUNT", || c.ft_mint(acc("a.testnet"), U128(0)));
}
#[test] fn faucet_daily_cap_and_rollover() {
    let mut c = new_ft();
    c.ft_mint(acc("a.testnet"), U128(10_000));
    c.ft_mint(acc("a.testnet"), U128(10_000));
    c.ft_mint(acc("a.testnet"), U128(5_000)); // 25_000 = cap
    assert_eq!(c.faucet_remaining(acc("a.testnet")).0, 0);
    expect_err("FAUCET_CAP_DAILY", || c.ft_mint(acc("a.testnet"), U128(1)));
    c.ft_mint(acc("b.testnet"), U128(1)); // other account unaffected
    ctx("x.testnet", T0 + DAY_NS - 1);
    expect_err("FAUCET_CAP_DAILY", || c.ft_mint(acc("a.testnet"), U128(1)));
    ctx("x.testnet", T0 + DAY_NS); // window elapsed
    c.ft_mint(acc("a.testnet"), U128(10_000));
    assert_eq!(c.faucet_remaining(acc("a.testnet")).0, 15_000);
}
#[test] fn privileged_mint_requires_minter() {
    let mut c = new_ft();
    ctx("eve.testnet", T0);
    expect_err("NOT_MINTER", || c.ft_mint_privileged(acc("eve.testnet"), U128(1)));
    ctx("bridge.testnet", T0);
    c.ft_mint_privileged(acc("rina.testnet"), U128(1_000_000)); // no cap
    assert_eq!(bal(&c, "rina.testnet"), 1_000_000);
}
#[test] fn owner_counts_as_minter() {
    let mut c = new_ft();
    ctx("admin.testnet", T0);
    c.ft_mint_privileged(acc("a.testnet"), U128(5));
}
#[test] fn burn_reduces_supply_and_requires_minter() {
    let mut c = new_ft();
    ctx("bridge.testnet", T0);
    c.ft_mint_privileged(acc("bridge.testnet"), U128(100));
    c.ft_burn_privileged(U128(40));
    assert_eq!(bal(&c, "bridge.testnet"), 60);
    assert_eq!(c.ft_total_supply().0, 60);
    expect_err("NOT_MINTER", || { ctx("eve.testnet", T0); c.ft_burn_privileged(U128(1)) });
}
#[test] fn burn_more_than_balance_panics() {
    let mut c = new_ft();
    ctx("bridge.testnet", T0);
    c.ft_mint_privileged(acc("bridge.testnet"), U128(10));
    assert!(catch_unwind(AssertUnwindSafe(|| c.ft_burn_privileged(U128(11)))).is_err());
    assert_eq!(c.ft_total_supply().0, 10);
}
#[test] fn resolve_unused_burns_from_receiver_only_up_to_balance() {
    let mut c = new_ft();
    ctx("bridge.testnet", T0);
    c.ft_mint_privileged(acc("core.testnet"), U128(100));
    assert_eq!(c.resolve_unused(&acc("core.testnet"), 30).0, 30);
    assert_eq!(bal(&c, "core.testnet"), 70);
    assert_eq!(c.resolve_unused(&acc("core.testnet"), 500).0, 70, "cannot burn more than held");
    assert_eq!(c.ft_total_supply().0, 0);
}
#[test] fn caps_view_and_constructor_validation() {
    let c = new_ft();
    assert_eq!(c.get_caps().per_call.0, 10_000);
    ctx("admin.testnet", T0);
    assert!(catch_unwind(|| Contract::new(acc("a.testnet"), "x".into(), "X".into(), 6, vec![], U128(10), U128(5))).is_err());
}
#[test] fn set_minters_admin_only() {
    let mut c = new_ft();
    ctx("eve.testnet", T0);
    expect_err("NOT_ADMIN", || c.set_minters(vec![]));
    ctx("admin.testnet", T0);
    c.set_minters(vec![acc("new.testnet")]);
    assert_eq!(c.get_minters(), vec![acc("new.testnet")]);
}
#[test] fn metadata_is_six_decimals() {
    let c = new_ft();
    assert_eq!(c.ft_metadata().decimals, 6);
    assert_eq!(c.ft_metadata().symbol, "USDC");
}
#[test] fn standard_transfer_works() {
    let mut c = new_ft();
    c.ft_mint(acc("a.testnet"), U128(100));
    testing_env!(VMContextBuilder::new().predecessor_account_id(acc("a.testnet")).attached_deposit(NearToken::from_millinear(10)).build());
    c.storage_deposit(Some(acc("b.testnet")), Some(true));
    testing_env!(VMContextBuilder::new().predecessor_account_id(acc("a.testnet")).attached_deposit(NearToken::from_yoctonear(1)).build());
    c.ft_transfer(acc("b.testnet"), U128(40), None);
    assert_eq!(bal(&c, "b.testnet"), 40);
    assert_eq!(bal(&c, "a.testnet"), 60);
}
