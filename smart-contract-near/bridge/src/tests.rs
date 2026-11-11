use super::*;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::testing_env;
use std::panic::{catch_unwind, AssertUnwindSafe};

fn acc(s: &str) -> AccountId { s.parse().unwrap() }
fn ctx(who: &str) {
    testing_env!(VMContextBuilder::new().predecessor_account_id(acc(who)).current_account_id(acc("bridge.testnet")).block_timestamp(1_000).build());
}
fn new_b() -> Contract {
    ctx("admin.testnet");
    Contract::new(acc("admin.testnet"), acc("worker.testnet"), acc("core.testnet"), vec![acc("usdc.testnet")])
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
const ADDR: &str = "0xAbCdEf0123456789aBcDeF0123456789abcdef01";
fn msg(chain: &str, addr: &str) -> String { json!({"dest_chain": chain, "dest_address": addr}).to_string() }
fn bin(c: &mut Contract, nonce: u64, chain: &str) -> PromiseOrValue<bool> {
    c.bridge_in(acc("usdc.testnet"), acc("rina.testnet"), U128(100), chain.into(), U64(nonce), "0xtx".into(), None)
}

#[test] fn bridge_in_only_relayer() {
    let mut c = new_b();
    ctx("eve.testnet");
    expect_err("BRIDGE_NOT_RELAYER", || bin(&mut c, 1, "sepolia"));
}
#[test] fn bridge_in_marks_processed_and_is_idempotent() {
    let mut c = new_b();
    ctx("worker.testnet");
    assert!(matches!(bin(&mut c, 1, "sepolia"), PromiseOrValue::Promise(_)));
    assert!(c.is_processed("sepolia".into(), U64(1)));
    match bin(&mut c, 1, "sepolia") { PromiseOrValue::Value(false) => {}, _ => panic!("replay must be no-op") }
    // same nonce on a different chain is distinct
    assert!(matches!(bin(&mut c, 1, "baseSepolia"), PromiseOrValue::Promise(_)));
}
#[test] fn bridge_in_validation() {
    let mut c = new_b();
    ctx("worker.testnet");
    expect_err("BRIDGE_BAD_CHAIN", || bin(&mut c, 1, "mainnet"));
    expect_err("BRIDGE_ASSET_DISABLED", || c.bridge_in(acc("xau.testnet"), acc("r.testnet"), U128(1), "sepolia".into(), U64(1), "t".into(), None));
    expect_err("INVALID_AMOUNT", || c.bridge_in(acc("usdc.testnet"), acc("r.testnet"), U128(0), "sepolia".into(), U64(1), "t".into(), None));
    assert!(!c.is_processed("sepolia".into(), U64(1)), "failed calls must not consume the nonce");
}
#[test] fn bridge_in_with_fund_target() {
    let mut c = new_b();
    ctx("worker.testnet");
    let r = c.bridge_in(acc("usdc.testnet"), acc("rina.testnet"), U128(5), "sepolia".into(), U64(9), "t".into(), Some(FundTarget { package_id: U64(3), part_id: 1 }));
    assert!(matches!(r, PromiseOrValue::Promise(_)));
}
#[test] fn paused_blocks_everything() {
    let mut c = new_b();
    ctx("admin.testnet");
    c.set_paused(true);
    ctx("worker.testnet");
    expect_err("PAUSED", || bin(&mut c, 1, "sepolia"));
    ctx("usdc.testnet");
    expect_err("PAUSED", || c.ft_on_transfer(acc("rina.testnet"), U128(1), msg("sepolia", ADDR)));
}
#[test] fn outbound_records_and_lowercases() {
    let mut c = new_b();
    ctx("usdc.testnet");
    let _ = c.ft_on_transfer(acc("rina.testnet"), U128(7), msg("baseSepolia", ADDR));
    let o = c.get_outbound(U64(1)).unwrap();
    assert_eq!((o.amount.0, o.dest_chain.as_str()), (7, "baseSepolia"));
    assert_eq!(o.dest_address, ADDR.to_lowercase());
    assert_eq!(c.next_out_nonce().0, 2);
    let _ = c.ft_on_transfer(acc("rina.testnet"), U128(8), msg("sepolia", ADDR));
    assert_eq!(c.get_outbound_range(U64(1), 10).len(), 2);
    assert_eq!(c.get_outbound_range(U64(2), 10)[0].nonce, 2);
    assert!(c.get_outbound_range(U64(5), 10).is_empty());
}
#[test] fn outbound_validation() {
    let mut c = new_b();
    ctx("usdc.testnet");
    expect_err("BAD_MSG", || c.ft_on_transfer(acc("r.testnet"), U128(1), "nope".into()));
    expect_err("BRIDGE_BAD_CHAIN", || c.ft_on_transfer(acc("r.testnet"), U128(1), msg("mainnet", ADDR)));
    for bad in ["", "0x123", "abcdef0123456789abcdef0123456789abcdef0123", "0xZZcdef0123456789aBcDeF0123456789abcdef01", "0x0000000000000000000000000000000000000000"] {
        expect_err("BRIDGE_BAD_ADDRESS", || c.ft_on_transfer(acc("r.testnet"), U128(1), msg("sepolia", bad)));
    }
    expect_err("INVALID_AMOUNT", || c.ft_on_transfer(acc("r.testnet"), U128(0), msg("sepolia", ADDR)));
    ctx("junk.testnet");
    expect_err("BRIDGE_ASSET_DISABLED", || c.ft_on_transfer(acc("r.testnet"), U128(1), msg("sepolia", ADDR)));
    assert_eq!(c.next_out_nonce().0, 1, "no nonce consumed on failures");
}
#[test] fn admin_controls() {
    let mut c = new_b();
    ctx("eve.testnet");
    expect_err("NOT_ADMIN", || c.set_paused(true));
    expect_err("NOT_ADMIN", || c.set_relayer(acc("eve.testnet")));
    expect_err("NOT_ADMIN", || c.set_bridgeable(acc("x.testnet"), true));
    ctx("admin.testnet");
    c.set_bridgeable(acc("x.testnet"), true);
    assert!(c.is_bridgeable(acc("x.testnet")));
    c.set_bridgeable(acc("x.testnet"), false);
    assert!(!c.is_bridgeable(acc("x.testnet")));
    c.set_relayer(acc("new.testnet"));
    ctx("worker.testnet");
    expect_err("BRIDGE_NOT_RELAYER", || bin(&mut c, 1, "sepolia"));
}
#[test] fn evm_address_rules() {
    assert!(valid_evm_address(ADDR));
    assert!(!valid_evm_address("0x"));
}
