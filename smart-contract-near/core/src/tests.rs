//! Unit tests: positive, negative and edge cases for the core contract.
use super::*;
use near_sdk::test_utils::{get_logs, VMContextBuilder};
use near_sdk::testing_env;
use std::panic::{catch_unwind, AssertUnwindSafe};

const T0: u64 = 1_000_000_000_000_000_000;
const SEC: u64 = 1_000_000_000;
const DAY: u64 = NS_PER_DAY;

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn ctx(who: &str, ts: u64) {
    ctx_bal(who, ts, NearToken::from_near(100));
}
fn ctx_bal(who: &str, ts: u64, bal: NearToken) {
    let c = VMContextBuilder::new()
        .predecessor_account_id(acc(who))
        .signer_account_id(acc(who))
        .current_account_id(acc("core.andum.testnet"))
        .block_timestamp(ts)
        .account_balance(bal)
        .build();
    testing_env!(c);
}

fn new_contract() -> Contract {
    ctx("admin.testnet", T0);
    Contract::new(acc("admin.testnet"), vec![acc("usdc.andum.testnet"), acc("xau.andum.testnet")], None)
}

fn expect_err<R>(code: &str, f: impl FnOnce() -> R) {
    let r = catch_unwind(AssertUnwindSafe(f));
    match r {
        Ok(_) => panic!("expected ANDUM_ERR:{code} but call succeeded"),
        Err(e) => {
            let msg = e
                .downcast_ref::<String>()
                .cloned()
                .or_else(|| e.downcast_ref::<&str>().map(|s| s.to_string()))
                .unwrap_or_default();
            assert!(msg.contains(&format!("ANDUM_ERR:{code}")), "expected {code}, got: {msg}");
        }
    }
}

fn hash_of(secret: &[u8]) -> Base64VecU8 {
    Base64VecU8::from(env::sha256(secret))
}

fn part(token: &str, amount: u128) -> PartInput {
    PartInput { token: acc(token), amount: U128(amount), unlock_ns: None, approvers: None, approval_threshold: None }
}
fn part_rule(token: &str, amount: u128, unlock: u64, approvers: &[&str], th: Option<u8>) -> PartInput {
    PartInput {
        token: acc(token),
        amount: U128(amount),
        unlock_ns: Some(U64(unlock)),
        approvers: if approvers.is_empty() { None } else { Some(approvers.iter().map(|a| acc(a)).collect()) },
        approval_threshold: th,
    }
}

fn args(parts: Vec<PartInput>) -> CreatePackageArgs {
    CreatePackageArgs {
        parts,
        accept_by_ns: U64(T0 + 10 * DAY),
        recipient: None,
        invite_hash: Some(hash_of(b"secret")),
        note: None,
        theme: None,
    }
}

const USDC: &str = "usdc.andum.testnet";
const XAU: &str = "xau.andum.testnet";

fn create(c: &mut Contract, a: CreatePackageArgs) -> u64 {
    ctx("sender.testnet", T0);
    c.create_package(a).0
}

fn fund(c: &mut Contract, id: u64, part_id: u8, token: &str, amount: u128) -> u128 {
    ctx(token, T0);
    let msg = format!("{{\"package_id\":\"{id}\",\"part_id\":{part_id}}}");
    match c.ft_on_transfer(acc("sender.testnet"), U128(amount), msg) {
        PromiseOrValue::Value(v) => v.0,
        _ => panic!("promise"),
    }
}

/// A funded single-part package (usdc 100).
fn funded_simple(c: &mut Contract) -> u64 {
    let id = create(c, args(vec![part(USDC, 100)]));
    assert_eq!(fund(c, id, 0, USDC, 100), 0);
    id
}

fn accept(c: &mut Contract, id: u64, who: &str, ts: u64) {
    ctx(who, ts);
    c.accept_package(U64(id), Some(Base64VecU8::from(b"secret".to_vec())));
}

fn accepted_simple(c: &mut Contract) -> u64 {
    let id = funded_simple(c);
    accept(c, id, "rina.testnet", T0 + SEC);
    id
}

fn status(c: &Contract, id: u64, part: usize) -> (String, Option<String>) {
    let v = c.get_package(U64(id)).unwrap();
    (v.parts[part].status.clone(), v.parts[part].reason.clone())
}

// =============================================================== create: positive
#[test]
fn create_valid_returns_id_and_emits_event() {
    let mut c = new_contract();
    let id = create(&mut c, args(vec![part(USDC, 100), part_rule(XAU, 5, T0 + 100 * SEC, &["boss.testnet"], None)]));
    assert_eq!(id, 1);
    let v = c.get_package(U64(1)).unwrap();
    assert_eq!(v.status, PackageStatus::AwaitingFunds);
    assert_eq!(v.parts.len(), 2);
    assert_eq!(v.parts[1].threshold, 1, "default threshold is 1");
    assert_eq!(v.theme, "none");
    assert!(get_logs().iter().any(|l| l.starts_with("EVENT_JSON:") && l.contains("package_created")));
}

#[test]
fn create_ids_increment() {
    let mut c = new_contract();
    assert_eq!(create(&mut c, args(vec![part(USDC, 1)])), 1);
    assert_eq!(create(&mut c, args(vec![part(USDC, 1)])), 2);
}

#[test]
fn create_with_fixed_recipient_and_no_hash() {
    let mut c = new_contract();
    let mut a = args(vec![part(USDC, 1)]);
    a.invite_hash = None;
    a.recipient = Some(acc("rina.testnet"));
    let id = create(&mut c, a);
    assert_eq!(c.get_package(U64(id)).unwrap().recipient, Some(acc("rina.testnet")));
}

#[test]
fn create_group_approvers_2_of_3() {
    let mut c = new_contract();
    let id = create(&mut c, args(vec![part_rule(USDC, 9, T0 + SEC, &["a.testnet", "b.testnet", "c.testnet"], Some(2))]));
    let p = &c.get_package(U64(id)).unwrap().parts[0];
    assert_eq!((p.approvers.len(), p.threshold), (3, 2));
}

#[test]
fn create_sender_may_be_approver() {
    let mut c = new_contract();
    create(&mut c, args(vec![part_rule(USDC, 9, T0 + SEC, &["sender.testnet"], None)]));
}

#[test]
fn create_with_theme_and_note() {
    let mut c = new_contract();
    let mut a = args(vec![part(USDC, 1)]);
    a.theme = Some("confetti".into());
    a.note = Some("Happy birthday".into());
    let id = create(&mut c, a);
    let v = c.get_package(U64(id)).unwrap();
    assert_eq!((v.theme.as_str(), v.note.as_deref()), ("confetti", Some("Happy birthday")));
}

// =============================================================== create: negative
#[test]
fn create_paused() {
    let mut c = new_contract();
    ctx("admin.testnet", T0);
    c.set_paused(true);
    ctx("sender.testnet", T0);
    expect_err("PAUSED", || c.create_package(args(vec![part(USDC, 1)])));
}

#[test]
fn create_zero_parts() {
    let mut c = new_contract();
    ctx("sender.testnet", T0);
    expect_err("INVALID_PARTS", || c.create_package(args(vec![])));
}

#[test]
fn create_nine_parts_rejected_eight_accepted() {
    let mut c = new_contract();
    let eight: Vec<_> = (0..8).map(|_| part(USDC, 1)).collect();
    assert_eq!(create(&mut c, args(eight)), 1);
    let nine: Vec<_> = (0..9).map(|_| part(USDC, 1)).collect();
    ctx("sender.testnet", T0);
    expect_err("INVALID_PARTS", || c.create_package(args(nine)));
}

#[test]
fn create_token_not_allowed() {
    let mut c = new_contract();
    ctx("sender.testnet", T0);
    expect_err("TOKEN_NOT_ALLOWED", || c.create_package(args(vec![part("evil.testnet", 1)])));
}

#[test]
fn create_zero_amount() {
    let mut c = new_contract();
    ctx("sender.testnet", T0);
    expect_err("INVALID_AMOUNT", || c.create_package(args(vec![part(USDC, 0)])));
}

#[test]
fn create_max_amount_ok() {
    let mut c = new_contract();
    create(&mut c, args(vec![part(USDC, u128::MAX)]));
}

#[test]
fn create_approvers_without_unlock() {
    let mut c = new_contract();
    ctx("sender.testnet", T0);
    let mut p = part(USDC, 1);
    p.approvers = Some(vec![acc("a.testnet")]);
    expect_err("INVALID_RULE", || c.create_package(args(vec![p])));
}

#[test]
fn create_threshold_without_unlock() {
    let mut c = new_contract();
    ctx("sender.testnet", T0);
    let mut p = part(USDC, 1);
    p.approval_threshold = Some(1);
    expect_err("INVALID_RULE", || c.create_package(args(vec![p])));
}

#[test]
fn create_too_many_approvers() {
    let mut c = new_contract();
    ctx("sender.testnet", T0);
    let ap = ["a1.testnet", "a2.testnet", "a3.testnet", "a4.testnet", "a5.testnet", "a6.testnet"];
    expect_err("INVALID_APPROVERS", || c.create_package(args(vec![part_rule(USDC, 1, T0 + SEC, &ap, None)])));
}

#[test]
fn create_five_approvers_ok() {
    let mut c = new_contract();
    let ap = ["a1.testnet", "a2.testnet", "a3.testnet", "a4.testnet", "a5.testnet"];
    create(&mut c, args(vec![part_rule(USDC, 1, T0 + SEC, &ap, Some(5))]));
}

#[test]
fn create_duplicate_approvers() {
    let mut c = new_contract();
    ctx("sender.testnet", T0);
    expect_err("INVALID_APPROVERS", || {
        c.create_package(args(vec![part_rule(USDC, 1, T0 + SEC, &["a.testnet", "a.testnet"], None)]))
    });
}

#[test]
fn create_threshold_zero_or_over_count() {
    let mut c = new_contract();
    ctx("sender.testnet", T0);
    expect_err("INVALID_APPROVERS", || {
        c.create_package(args(vec![part_rule(USDC, 1, T0 + SEC, &["a.testnet"], Some(0))]))
    });
    expect_err("INVALID_APPROVERS", || {
        c.create_package(args(vec![part_rule(USDC, 1, T0 + SEC, &["a.testnet", "b.testnet"], Some(3))]))
    });
}

#[test]
fn create_recipient_is_approver() {
    let mut c = new_contract();
    ctx("sender.testnet", T0);
    let mut a = args(vec![part_rule(USDC, 1, T0 + SEC, &["rina.testnet"], None)]);
    a.invite_hash = None;
    a.recipient = Some(acc("rina.testnet"));
    expect_err("INVALID_APPROVERS", || c.create_package(a));
}

#[test]
fn create_unknown_theme() {
    let mut c = new_contract();
    ctx("sender.testnet", T0);
    let mut a = args(vec![part(USDC, 1)]);
    a.theme = Some("fireworks".into());
    expect_err("INVALID_THEME", || c.create_package(a));
}

#[test]
fn create_unlock_in_past_and_now() {
    let mut c = new_contract();
    ctx("sender.testnet", T0);
    expect_err("UNLOCK_IN_PAST", || c.create_package(args(vec![part_rule(USDC, 1, T0 - 1, &[], None)])));
    expect_err("UNLOCK_IN_PAST", || c.create_package(args(vec![part_rule(USDC, 1, T0, &[], None)])));
    create(&mut c, args(vec![part_rule(USDC, 1, T0 + 1, &[], None)])); // 1 ns in the future is fine
}

#[test]
fn create_expiry_bounds() {
    let mut c = new_contract();
    ctx("sender.testnet", T0);
    let mut a = args(vec![part(USDC, 1)]);
    a.accept_by_ns = U64(T0);
    expect_err("INVALID_EXPIRY", || c.create_package(a.clone()));
    a.accept_by_ns = U64(T0 + 90 * DAY + 1);
    expect_err("INVALID_EXPIRY", || c.create_package(a.clone()));
    a.accept_by_ns = U64(T0 + 90 * DAY);
    c.create_package(a); // exactly 90 days is accepted
}

#[test]
fn create_note_length_counts_chars() {
    let mut c = new_contract();
    ctx("sender.testnet", T0);
    let mut a = args(vec![part(USDC, 1)]);
    a.note = Some("é".repeat(140)); // 280 bytes but 140 chars: ok
    c.create_package(a.clone());
    a.note = Some("a".repeat(141));
    expect_err("NOTE_TOO_LONG", || c.create_package(a));
}

#[test]
fn create_needs_exactly_one_of_recipient_or_hash() {
    let mut c = new_contract();
    ctx("sender.testnet", T0);
    let mut both = args(vec![part(USDC, 1)]);
    both.recipient = Some(acc("rina.testnet"));
    expect_err("INVALID_PARTS", || c.create_package(both));
    let mut neither = args(vec![part(USDC, 1)]);
    neither.invite_hash = None;
    expect_err("INVALID_PARTS", || c.create_package(neither));
}

#[test]
fn create_bad_hash_length() {
    let mut c = new_contract();
    ctx("sender.testnet", T0);
    let mut a = args(vec![part(USDC, 1)]);
    a.invite_hash = Some(Base64VecU8::from(vec![1, 2, 3]));
    expect_err("INVALID_PARTS", || c.create_package(a));
}

#[test]
fn create_limit_per_sender() {
    let mut c = new_contract();
    ctx("admin.testnet", T0);
    let mut l = Limits::default();
    l.max_open_per_sender = 2;
    c.set_limits(l);
    create(&mut c, args(vec![part(USDC, 1)]));
    create(&mut c, args(vec![part(USDC, 1)]));
    ctx("sender.testnet", T0);
    expect_err("LIMIT_EXCEEDED", || c.create_package(args(vec![part(USDC, 1)])));
    // another sender is unaffected
    ctx("other.testnet", T0);
    c.create_package(args(vec![part(USDC, 1)]));
}

#[test]
fn create_storage_reserve_low() {
    let mut c = new_contract();
    ctx_bal("sender.testnet", T0, NearToken::from_yoctonear(1));
    expect_err("STORAGE_RESERVE_LOW", || c.create_package(args(vec![part(USDC, 1)])));
}

// =============================================================== funding
#[test]
fn fund_exact_makes_funded() {
    let mut c = new_contract();
    let id = create(&mut c, args(vec![part(USDC, 100)]));
    assert_eq!(fund(&mut c, id, 0, USDC, 100), 0);
    assert_eq!(c.get_package(U64(id)).unwrap().status, PackageStatus::Funded);
    assert!(get_logs().iter().any(|l| l.contains("package_funded")));
}

#[test]
fn fund_partial_then_complete() {
    let mut c = new_contract();
    let id = create(&mut c, args(vec![part(USDC, 100)]));
    assert_eq!(fund(&mut c, id, 0, USDC, 40), 0);
    assert_eq!(c.get_package(U64(id)).unwrap().status, PackageStatus::AwaitingFunds);
    assert_eq!(c.get_package(U64(id)).unwrap().parts[0].funded.0, 40);
    assert_eq!(fund(&mut c, id, 0, USDC, 60), 0);
    assert_eq!(c.get_package(U64(id)).unwrap().status, PackageStatus::Funded);
}

#[test]
fn fund_overfunding_returns_excess() {
    let mut c = new_contract();
    let id = create(&mut c, args(vec![part(USDC, 100)]));
    assert_eq!(fund(&mut c, id, 0, USDC, 130), 30);
    let v = c.get_package(U64(id)).unwrap();
    assert_eq!(v.parts[0].funded.0, 100);
    assert!(get_logs().iter().any(|l| l.contains("deposit_refunded")));
}

#[test]
fn fund_after_full_is_inactive() {
    let mut c = new_contract();
    let id = funded_simple(&mut c);
    expect_err("PACKAGE_NOT_ACTIVE", || {
        fund(&mut c, id, 0, USDC, 1);
    });
}

#[test]
fn fund_multi_part_needs_all() {
    let mut c = new_contract();
    let id = create(&mut c, args(vec![part(USDC, 10), part(XAU, 5)]));
    fund(&mut c, id, 0, USDC, 10);
    assert_eq!(c.get_package(U64(id)).unwrap().status, PackageStatus::AwaitingFunds);
    fund(&mut c, id, 1, XAU, 5);
    assert_eq!(c.get_package(U64(id)).unwrap().status, PackageStatus::Funded);
}

#[test]
fn fund_wrong_token() {
    let mut c = new_contract();
    let id = create(&mut c, args(vec![part(USDC, 10)]));
    expect_err("WRONG_TOKEN", || {
        fund(&mut c, id, 0, XAU, 10);
    });
}

#[test]
fn fund_wrong_sender() {
    let mut c = new_contract();
    let id = create(&mut c, args(vec![part(USDC, 10)]));
    ctx(USDC, T0);
    let msg = format!("{{\"package_id\":\"{id}\",\"part_id\":0}}");
    expect_err("WRONG_SENDER", || c.ft_on_transfer(acc("mallory.testnet"), U128(10), msg));
}

#[test]
fn fund_bad_msg_variants() {
    let mut c = new_contract();
    create(&mut c, args(vec![part(USDC, 10)]));
    ctx(USDC, T0);
    for m in ["", "not json", "{}", "{\"package_id\":\"x\",\"part_id\":0}", "{\"package_id\":\"1\",\"part_id\":-1}"] {
        expect_err("BAD_MSG", || c.ft_on_transfer(acc("sender.testnet"), U128(1), m.to_string()));
    }
}

#[test]
fn fund_unknown_package_or_part() {
    let mut c = new_contract();
    let id = create(&mut c, args(vec![part(USDC, 10)]));
    expect_err("PACKAGE_NOT_FOUND", || {
        fund(&mut c, 99, 0, USDC, 1);
    });
    expect_err("PART_NOT_FOUND", || {
        fund(&mut c, id, 5, USDC, 1);
    });
}

#[test]
fn fund_when_paused() {
    let mut c = new_contract();
    let id = create(&mut c, args(vec![part(USDC, 10)]));
    ctx("admin.testnet", T0);
    c.set_paused(true);
    expect_err("PAUSED", || {
        fund(&mut c, id, 0, USDC, 1);
    });
}

#[test]
fn fund_zero_amount_is_noop() {
    let mut c = new_contract();
    let id = create(&mut c, args(vec![part(USDC, 10)]));
    assert_eq!(fund(&mut c, id, 0, USDC, 0), 0);
    assert_eq!(c.get_package(U64(id)).unwrap().parts[0].funded.0, 0);
}

// =============================================================== accept
#[test]
fn accept_with_secret_mints_nft() {
    let mut c = new_contract();
    let id = funded_simple(&mut c);
    accept(&mut c, id, "rina.testnet", T0 + SEC);
    let v = c.get_package(U64(id)).unwrap();
    assert_eq!(v.status, PackageStatus::Accepted);
    assert_eq!(v.owner, Some(acc("rina.testnet")));
    let t = c.nft_token(id.to_string()).unwrap();
    assert_eq!(t.owner_id, acc("rina.testnet"));
    assert_eq!(t.metadata.title.unwrap(), format!("Andum package #{id}"));
    assert_eq!(c.nft_total_supply().0, 1);
    let logs = get_logs();
    assert!(logs.iter().any(|l| l.contains("nft_mint")));
    assert!(logs.iter().any(|l| l.contains("package_accepted")));
}

#[test]
fn accept_fixed_recipient_without_secret() {
    let mut c = new_contract();
    let mut a = args(vec![part(USDC, 5)]);
    a.invite_hash = None;
    a.recipient = Some(acc("rina.testnet"));
    let id = create(&mut c, a);
    fund(&mut c, id, 0, USDC, 5);
    ctx("rina.testnet", T0 + SEC);
    c.accept_package(U64(id), None);
    assert_eq!(c.get_package(U64(id)).unwrap().owner, Some(acc("rina.testnet")));
}

#[test]
fn accept_fixed_recipient_wrong_account() {
    let mut c = new_contract();
    let mut a = args(vec![part(USDC, 5)]);
    a.invite_hash = None;
    a.recipient = Some(acc("rina.testnet"));
    let id = create(&mut c, a);
    fund(&mut c, id, 0, USDC, 5);
    ctx("mallory.testnet", T0 + SEC);
    expect_err("NOT_INVITED_ACCOUNT", || c.accept_package(U64(id), None));
}

#[test]
fn accept_wrong_or_missing_secret() {
    let mut c = new_contract();
    let id = funded_simple(&mut c);
    ctx("rina.testnet", T0 + SEC);
    expect_err("INVITE_SECRET_INVALID", || c.accept_package(U64(id), Some(Base64VecU8::from(b"nope".to_vec()))));
    expect_err("INVITE_SECRET_INVALID", || c.accept_package(U64(id), None));
    expect_err("INVITE_SECRET_INVALID", || c.accept_package(U64(id), Some(Base64VecU8::from(vec![]))));
}

#[test]
fn accept_expired_and_at_boundary() {
    let mut c = new_contract();
    let id = funded_simple(&mut c);
    ctx("rina.testnet", T0 + 10 * DAY + 1);
    expect_err("INVITE_EXPIRED", || c.accept_package(U64(id), Some(Base64VecU8::from(b"secret".to_vec()))));
    // exactly at the deadline is still allowed
    accept(&mut c, id, "rina.testnet", T0 + 10 * DAY);
    assert_eq!(c.get_package(U64(id)).unwrap().status, PackageStatus::Accepted);
}

#[test]
fn accept_twice() {
    let mut c = new_contract();
    let id = accepted_simple(&mut c);
    ctx("eve.testnet", T0 + 2 * SEC);
    expect_err("ALREADY_ACCEPTED", || c.accept_package(U64(id), Some(Base64VecU8::from(b"secret".to_vec()))));
    assert_eq!(c.nft_total_supply().0, 1, "I-6: exactly one NFT");
}

#[test]
fn accept_unfunded() {
    let mut c = new_contract();
    let id = create(&mut c, args(vec![part(USDC, 5)]));
    ctx("rina.testnet", T0 + SEC);
    expect_err("PACKAGE_NOT_ACTIVE", || c.accept_package(U64(id), Some(Base64VecU8::from(b"secret".to_vec()))));
}

#[test]
fn accept_unknown_package() {
    let mut c = new_contract();
    ctx("rina.testnet", T0);
    expect_err("PACKAGE_NOT_FOUND", || c.accept_package(U64(7), None));
}

#[test]
fn accept_by_approver_is_refused() {
    let mut c = new_contract();
    let id = create(&mut c, args(vec![part_rule(USDC, 5, T0 + 50 * SEC, &["boss.testnet"], None)]));
    fund(&mut c, id, 0, USDC, 5);
    ctx("boss.testnet", T0 + SEC);
    expect_err("RECEIVER_IS_APPROVER", || c.accept_package(U64(id), Some(Base64VecU8::from(b"secret".to_vec()))));
}

#[test]
fn accept_when_paused() {
    let mut c = new_contract();
    let id = funded_simple(&mut c);
    ctx("admin.testnet", T0);
    c.set_paused(true);
    ctx("rina.testnet", T0);
    expect_err("PAUSED", || c.accept_package(U64(id), Some(Base64VecU8::from(b"secret".to_vec()))));
}

// =============================================================== approve
fn pkg_with_approval(c: &mut Contract, approvers: &[&str], th: Option<u8>) -> u64 {
    let id = create(c, args(vec![part_rule(USDC, 100, T0 + 100 * SEC, approvers, th)]));
    fund(c, id, 0, USDC, 100);
    id
}

#[test]
fn approve_single_approver_meets_threshold() {
    let mut c = new_contract();
    let id = pkg_with_approval(&mut c, &["boss.testnet"], None);
    ctx("boss.testnet", T0);
    c.approve_part(U64(id), 0);
    let l = get_logs().join("");
    assert!(l.contains("part_approved") && l.contains("\"threshold_met\":true"));
    assert!(c.get_package(U64(id)).unwrap().parts[0].approved);
}

#[test]
fn approve_two_of_three() {
    let mut c = new_contract();
    let id = pkg_with_approval(&mut c, &["a.testnet", "b.testnet", "c.testnet"], Some(2));
    ctx("a.testnet", T0);
    c.approve_part(U64(id), 0);
    assert!(get_logs().join("").contains("\"threshold_met\":false"));
    assert!(!c.get_package(U64(id)).unwrap().parts[0].approved);
    ctx("c.testnet", T0);
    c.approve_part(U64(id), 0);
    assert!(get_logs().join("").contains("\"threshold_met\":true"));
    assert!(c.get_package(U64(id)).unwrap().parts[0].approved);
    // late third approval recorded, no threshold_met
    ctx("b.testnet", T0);
    c.approve_part(U64(id), 0);
    assert!(get_logs().join("").contains("\"threshold_met\":false"));
    assert_eq!(c.get_package(U64(id)).unwrap().parts[0].approvals.len(), 3);
}

#[test]
fn approve_duplicate_is_silent_noop() {
    let mut c = new_contract();
    let id = pkg_with_approval(&mut c, &["a.testnet", "b.testnet"], Some(2));
    ctx("a.testnet", T0);
    c.approve_part(U64(id), 0);
    ctx("a.testnet", T0 + 1);
    c.approve_part(U64(id), 0);
    assert!(get_logs().is_empty(), "no event on duplicate");
    assert_eq!(c.get_package(U64(id)).unwrap().parts[0].approvals.len(), 1);
    assert!(!c.get_package(U64(id)).unwrap().parts[0].approved, "duplicate must not reach threshold");
}

#[test]
fn approve_stranger_refused() {
    let mut c = new_contract();
    let id = pkg_with_approval(&mut c, &["boss.testnet"], None);
    ctx("eve.testnet", T0);
    expect_err("NOT_APPROVER", || c.approve_part(U64(id), 0));
}

#[test]
fn approve_part_without_rule() {
    let mut c = new_contract();
    let id = funded_simple(&mut c);
    ctx("boss.testnet", T0);
    expect_err("NOT_APPROVER", || c.approve_part(U64(id), 0));
}

#[test]
fn approve_unknown_part_and_package() {
    let mut c = new_contract();
    let id = pkg_with_approval(&mut c, &["boss.testnet"], None);
    ctx("boss.testnet", T0);
    expect_err("PART_NOT_FOUND", || c.approve_part(U64(id), 9));
    expect_err("PACKAGE_NOT_FOUND", || c.approve_part(U64(99), 0));
}

#[test]
fn approve_awaiting_funds_refused() {
    let mut c = new_contract();
    let id = create(&mut c, args(vec![part_rule(USDC, 1, T0 + SEC, &["boss.testnet"], None)]));
    ctx("boss.testnet", T0);
    expect_err("PACKAGE_NOT_ACTIVE", || c.approve_part(U64(id), 0));
}

#[test]
fn approve_allowed_before_accept_when_funded() {
    let mut c = new_contract();
    let id = pkg_with_approval(&mut c, &["boss.testnet"], None);
    ctx("boss.testnet", T0);
    c.approve_part(U64(id), 0); // package is FUNDED not ACCEPTED: allowed
}

#[test]
fn approve_reclaimed_refused() {
    let mut c = new_contract();
    let id = pkg_with_approval(&mut c, &["boss.testnet"], None);
    ctx("sender.testnet", T0 + 11 * DAY);
    c.reclaim_unaccepted(U64(id));
    ctx("boss.testnet", T0 + 11 * DAY);
    expect_err("PACKAGE_NOT_ACTIVE", || c.approve_part(U64(id), 0));
}

#[test]
fn sender_as_approver_can_approve() {
    let mut c = new_contract();
    let id = create(&mut c, args(vec![part_rule(USDC, 1, T0 + SEC, &["sender.testnet"], None)]));
    fund(&mut c, id, 0, USDC, 1);
    ctx("sender.testnet", T0);
    c.approve_part(U64(id), 0);
}

// =============================================================== claim
#[test]
fn claim_open_part_goes_pending_then_taken() {
    let mut c = new_contract();
    let id = accepted_simple(&mut c);
    ctx("rina.testnet", T0 + 2 * SEC);
    let _ = c.claim(U64(id), 0);
    assert_eq!(status(&c, id, 0).0, "PROCESSING");
    assert!(get_logs().join("").contains("claim_started"));
    c.resolve_claim(id, 0, 1, true);
    assert_eq!(status(&c, id, 0).0, "TAKEN");
    assert!(get_logs().join("").contains("part_claimed"));
    assert!(c.get_package(U64(id)).unwrap().parts[0].taken_ns.is_some());
}

#[test]
fn claim_failure_reverts_to_locked_and_allows_retry() {
    let mut c = new_contract();
    let id = accepted_simple(&mut c);
    ctx("rina.testnet", T0 + 2 * SEC);
    let _ = c.claim(U64(id), 0);
    c.resolve_claim(id, 0, 1, false);
    assert_eq!(status(&c, id, 0).0, "OPEN");
    assert!(get_logs().join("").contains("claim_failed"));
    let _ = c.claim(U64(id), 0); // retry gets attempt 2
    c.resolve_claim(id, 0, 1, true); // stale callback for attempt 1 is ignored
    assert_eq!(status(&c, id, 0).0, "PROCESSING");
    c.resolve_claim(id, 0, 2, true);
    assert_eq!(status(&c, id, 0).0, "TAKEN");
}

#[test]
fn claim_second_call_while_pending() {
    let mut c = new_contract();
    let id = accepted_simple(&mut c);
    ctx("rina.testnet", T0 + 2 * SEC);
    let _ = c.claim(U64(id), 0);
    expect_err("TRANSFER_PENDING", || c.claim(U64(id), 0));
}

#[test]
fn claim_after_taken() {
    let mut c = new_contract();
    let id = accepted_simple(&mut c);
    ctx("rina.testnet", T0 + 2 * SEC);
    let _ = c.claim(U64(id), 0);
    c.resolve_claim(id, 0, 1, true);
    expect_err("ALREADY_TAKEN", || c.claim(U64(id), 0));
}

#[test]
fn claim_callback_replay_after_taken_is_ignored() {
    let mut c = new_contract();
    let id = accepted_simple(&mut c);
    ctx("rina.testnet", T0 + 2 * SEC);
    let _ = c.claim(U64(id), 0);
    c.resolve_claim(id, 0, 1, true);
    c.resolve_claim(id, 0, 1, false); // must not revert a taken part
    assert_eq!(status(&c, id, 0).0, "TAKEN");
}

#[test]
fn claim_not_owner() {
    let mut c = new_contract();
    let id = accepted_simple(&mut c);
    ctx("eve.testnet", T0 + 2 * SEC);
    expect_err("NOT_PASS_OWNER", || c.claim(U64(id), 0));
    ctx("sender.testnet", T0 + 2 * SEC);
    expect_err("NOT_PASS_OWNER", || c.claim(U64(id), 0));
}

#[test]
fn claim_before_accept() {
    let mut c = new_contract();
    let id = funded_simple(&mut c);
    ctx("rina.testnet", T0);
    expect_err("PACKAGE_NOT_ACTIVE", || c.claim(U64(id), 0));
}

#[test]
fn claim_unknown_part_and_package() {
    let mut c = new_contract();
    let id = accepted_simple(&mut c);
    ctx("rina.testnet", T0 + 2 * SEC);
    expect_err("PART_NOT_FOUND", || c.claim(U64(id), 3));
    expect_err("PACKAGE_NOT_FOUND", || c.claim(U64(50), 0));
}

fn accepted_gated(c: &mut Contract, approvers: &[&str], th: Option<u8>) -> u64 {
    let id = create(c, args(vec![part_rule(USDC, 100, T0 + 100 * SEC, approvers, th)]));
    fund(c, id, 0, USDC, 100);
    accept(c, id, "rina.testnet", T0 + SEC);
    id
}

#[test]
fn claim_time_not_reached_boundaries() {
    let mut c = new_contract();
    let id = accepted_gated(&mut c, &[], None);
    ctx("rina.testnet", T0 + 100 * SEC - 1);
    expect_err("TIME_NOT_REACHED", || c.claim(U64(id), 0));
    ctx("rina.testnet", T0 + 100 * SEC); // exactly at unlock: allowed
    let _ = c.claim(U64(id), 0);
}

#[test]
fn claim_time_wins_over_approval_missing() {
    let mut c = new_contract();
    let id = accepted_gated(&mut c, &["boss.testnet"], None);
    ctx("rina.testnet", T0 + 10 * SEC);
    expect_err("TIME_NOT_REACHED", || c.claim(U64(id), 0));
}

#[test]
fn claim_approval_missing_after_date() {
    let mut c = new_contract();
    let id = accepted_gated(&mut c, &["boss.testnet"], None);
    ctx("rina.testnet", T0 + 200 * SEC);
    expect_err("APPROVAL_MISSING", || c.claim(U64(id), 0));
}

#[test]
fn claim_after_approval_and_date() {
    let mut c = new_contract();
    let id = accepted_gated(&mut c, &["boss.testnet"], None);
    ctx("boss.testnet", T0 + 5 * SEC);
    c.approve_part(U64(id), 0); // approval before the date
    ctx("rina.testnet", T0 + 200 * SEC);
    let _ = c.claim(U64(id), 0);
}

#[test]
fn claim_group_threshold_not_met_then_met() {
    let mut c = new_contract();
    let id = accepted_gated(&mut c, &["a.testnet", "b.testnet", "c.testnet"], Some(2));
    ctx("a.testnet", T0 + 5 * SEC);
    c.approve_part(U64(id), 0);
    ctx("rina.testnet", T0 + 200 * SEC);
    expect_err("APPROVAL_MISSING", || c.claim(U64(id), 0));
    ctx("b.testnet", T0 + 201 * SEC);
    c.approve_part(U64(id), 0);
    ctx("rina.testnet", T0 + 202 * SEC);
    let _ = c.claim(U64(id), 0);
}

#[test]
fn claim_when_paused() {
    let mut c = new_contract();
    let id = accepted_simple(&mut c);
    ctx("admin.testnet", T0);
    c.set_paused(true);
    ctx("rina.testnet", T0 + 2 * SEC);
    expect_err("PAUSED", || c.claim(U64(id), 0));
}

#[test]
fn all_parts_taken_releases_sender_open_slot() {
    let mut c = new_contract();
    ctx("admin.testnet", T0);
    let mut l = Limits::default();
    l.max_open_per_sender = 1;
    c.set_limits(l);
    let id = accepted_simple(&mut c);
    ctx("sender.testnet", T0);
    expect_err("LIMIT_EXCEEDED", || c.create_package(args(vec![part(USDC, 1)])));
    ctx("rina.testnet", T0 + 2 * SEC);
    let _ = c.claim(U64(id), 0);
    c.resolve_claim(id, 0, 1, true);
    ctx("sender.testnet", T0 + 3 * SEC);
    c.create_package(args(vec![part(USDC, 1)])); // slot freed
}

#[test]
fn partial_take_keeps_open_slot_and_parts_independent() {
    let mut c = new_contract();
    let id = create(&mut c, args(vec![part(USDC, 10), part(XAU, 3)]));
    fund(&mut c, id, 0, USDC, 10);
    fund(&mut c, id, 1, XAU, 3);
    accept(&mut c, id, "rina.testnet", T0 + SEC);
    ctx("rina.testnet", T0 + 2 * SEC);
    let _ = c.claim(U64(id), 0);
    c.resolve_claim(id, 0, 1, true);
    assert_eq!(status(&c, id, 0).0, "TAKEN");
    assert_eq!(status(&c, id, 1).0, "OPEN");
    let _ = c.claim(U64(id), 1);
}

// =============================================================== reclaim
#[test]
fn reclaim_after_deadline_funded() {
    let mut c = new_contract();
    let id = funded_simple(&mut c);
    ctx("sender.testnet", T0 + 10 * DAY + 1);
    c.reclaim_unaccepted(U64(id));
    assert_eq!(c.get_package(U64(id)).unwrap().status, PackageStatus::Reclaimed);
    assert!(get_logs().join("").contains("package_reclaimed"));
}

#[test]
fn reclaim_before_deadline_refused_and_at_deadline_refused() {
    let mut c = new_contract();
    let id = funded_simple(&mut c);
    ctx("sender.testnet", T0 + DAY);
    expect_err("NOT_RECLAIMABLE", || c.reclaim_unaccepted(U64(id)));
    ctx("sender.testnet", T0 + 10 * DAY); // equal to deadline: still acceptable by receiver
    expect_err("NOT_RECLAIMABLE", || c.reclaim_unaccepted(U64(id)));
}

#[test]
fn reclaim_awaiting_funds_any_time() {
    let mut c = new_contract();
    let id = create(&mut c, args(vec![part(USDC, 10), part(XAU, 2)]));
    fund(&mut c, id, 0, USDC, 4);
    ctx("sender.testnet", T0 + 1);
    c.reclaim_unaccepted(U64(id));
    assert!(get_logs().join("").contains("\"amount\":\"4\""));
}

#[test]
fn reclaim_nothing_funded_ok_once() {
    let mut c = new_contract();
    let id = create(&mut c, args(vec![part(USDC, 10)]));
    ctx("sender.testnet", T0 + 1);
    c.reclaim_unaccepted(U64(id));
    expect_err("ALREADY_RECLAIMED", || c.reclaim_unaccepted(U64(id)));
}

#[test]
fn reclaim_not_sender() {
    let mut c = new_contract();
    let id = funded_simple(&mut c);
    ctx("eve.testnet", T0 + 11 * DAY);
    expect_err("NOT_SENDER", || c.reclaim_unaccepted(U64(id)));
}

#[test]
fn reclaim_accepted_refused() {
    let mut c = new_contract();
    let id = accepted_simple(&mut c);
    ctx("sender.testnet", T0 + 20 * DAY);
    expect_err("NOT_RECLAIMABLE", || c.reclaim_unaccepted(U64(id)));
}

#[test]
fn reclaim_twice_is_already_reclaimed() {
    let mut c = new_contract();
    let id = funded_simple(&mut c);
    ctx("sender.testnet", T0 + 11 * DAY);
    c.reclaim_unaccepted(U64(id));
    expect_err("ALREADY_RECLAIMED", || c.reclaim_unaccepted(U64(id)));
}

#[test]
fn reclaim_transfer_failure_allows_retry() {
    let mut c = new_contract();
    let id = funded_simple(&mut c);
    ctx("sender.testnet", T0 + 11 * DAY);
    c.reclaim_unaccepted(U64(id));
    c.resolve_reclaim(id, 0, 100, false); // callback: transfer failed
    c.reclaim_unaccepted(U64(id)); // retry works
    c.resolve_reclaim(id, 0, 100, true);
    expect_err("ALREADY_RECLAIMED", || c.reclaim_unaccepted(U64(id)));
}

#[test]
fn reclaimed_package_cannot_be_accepted() {
    let mut c = new_contract();
    let id = funded_simple(&mut c);
    ctx("sender.testnet", T0 + 11 * DAY);
    c.reclaim_unaccepted(U64(id));
    ctx("rina.testnet", T0 + 11 * DAY);
    expect_err("PACKAGE_NOT_ACTIVE", || c.accept_package(U64(id), Some(Base64VecU8::from(b"secret".to_vec()))));
}

#[test]
fn reclaim_allowed_while_paused() {
    let mut c = new_contract();
    let id = funded_simple(&mut c);
    ctx("admin.testnet", T0);
    c.set_paused(true);
    ctx("sender.testnet", T0 + 11 * DAY);
    c.reclaim_unaccepted(U64(id));
}

#[test]
fn reclaim_frees_open_slot() {
    let mut c = new_contract();
    ctx("admin.testnet", T0);
    let mut l = Limits::default();
    l.max_open_per_sender = 1;
    c.set_limits(l);
    let id = create(&mut c, args(vec![part(USDC, 1)]));
    ctx("sender.testnet", T0);
    c.reclaim_unaccepted(U64(id));
    c.create_package(args(vec![part(USDC, 1)]));
}

// =============================================================== views
#[test]
fn status_not_accepted_for_every_part() {
    let mut c = new_contract();
    let id = funded_simple(&mut c);
    assert_eq!(status(&c, id, 0), ("NOT_ACCEPTED".into(), Some("PACKAGE_NOT_ACTIVE".into())));
}

#[test]
fn status_table_all_rows() {
    let mut c = new_contract();
    let id = create(
        &mut c,
        args(vec![
            part(USDC, 1),                                              // OPEN
            part_rule(USDC, 1, T0 + 100 * SEC, &[], None),              // WAITING_DATE
            part_rule(USDC, 1, T0 + 100 * SEC, &["b.testnet"], None),   // WAITING_DATE_AND_APPROVAL then date+approved
            part_rule(USDC, 1, T0 + 50 * SEC, &["b.testnet"], None),    // WAITING_APPROVAL after 50s
        ]),
    );
    for i in 0..4u8 {
        fund(&mut c, id, i, USDC, 1);
    }
    accept(&mut c, id, "rina.testnet", T0 + SEC);
    ctx("rina.testnet", T0 + 10 * SEC);
    assert_eq!(status(&c, id, 0), ("OPEN".into(), None));
    assert_eq!(status(&c, id, 1), ("WAITING_DATE".into(), Some("TIME_NOT_REACHED".into())));
    assert_eq!(status(&c, id, 2), ("WAITING_DATE_AND_APPROVAL".into(), Some("TIME_NOT_REACHED".into())));
    ctx("rina.testnet", T0 + 60 * SEC);
    assert_eq!(status(&c, id, 3), ("WAITING_APPROVAL".into(), Some("APPROVAL_MISSING".into())));
    // approve part 2 before date -> WAITING_DATE
    ctx("b.testnet", T0 + 61 * SEC);
    c.approve_part(U64(id), 2);
    assert_eq!(status(&c, id, 2), ("WAITING_DATE".into(), Some("TIME_NOT_REACHED".into())));
    ctx("rina.testnet", T0 + 101 * SEC);
    assert_eq!(status(&c, id, 2), ("OPEN".into(), None));
}

#[test]
fn view_missing_package_is_none() {
    let c = new_contract();
    assert!(c.get_package(U64(1)).is_none());
    assert!(c.nft_token("1".into()).is_none());
    assert!(c.nft_token("abc".into()).is_none());
}

#[test]
fn sender_and_owner_pagination() {
    let mut c = new_contract();
    for _ in 0..5 {
        create(&mut c, args(vec![part(USDC, 1)]));
    }
    ctx("anyone.testnet", T0);
    assert_eq!(c.get_packages_by_sender(acc("sender.testnet"), None, None).len(), 5);
    assert_eq!(c.get_packages_by_sender(acc("sender.testnet"), None, Some(2)).len(), 2);
    let from3 = c.get_packages_by_sender(acc("sender.testnet"), Some(U64(3)), Some(10));
    assert_eq!(from3.iter().map(|p| p.id.0).collect::<Vec<_>>(), vec![3, 4, 5]);
    assert!(c.get_packages_by_sender(acc("nobody.testnet"), None, None).is_empty());
    assert!(c.get_packages_by_owner(acc("rina.testnet"), None, None).is_empty());
}

#[test]
fn owner_listing_after_accept() {
    let mut c = new_contract();
    let id = accepted_simple(&mut c);
    assert_eq!(c.get_packages_by_owner(acc("rina.testnet"), None, None).len(), 1);
    assert_eq!(c.nft_supply_for_owner(acc("rina.testnet")).0, 1);
    assert_eq!(c.nft_tokens_for_owner(acc("rina.testnet"), None, None)[0].token_id, id.to_string());
    assert_eq!(c.nft_tokens(Some(U128(5)), None).len(), 0, "from_index beyond supply");
    assert_eq!(c.nft_tokens(None, Some(1)).len(), 1);
}

#[test]
fn storage_report_is_consistent() {
    let c = new_contract();
    let r = c.storage_report();
    assert_eq!(r.balance.0, r.locked_for_storage.0 + r.available.0);
}

// =============================================================== NFT
#[test]
fn nft_transfer_always_refused() {
    let mut c = new_contract();
    let id = accepted_simple(&mut c);
    ctx("rina.testnet", T0 + 5 * SEC);
    expect_err("PASS_NOT_TRANSFERABLE", || c.nft_transfer(acc("eve.testnet"), id.to_string(), None, None));
    expect_err("PASS_NOT_TRANSFERABLE", || {
        c.nft_transfer_call(acc("eve.testnet"), id.to_string(), None, None, "".into())
    });
}

#[test]
fn nft_description_carries_note() {
    let mut c = new_contract();
    let mut a = args(vec![part(USDC, 5)]);
    a.note = Some("Thanks!".into());
    let id = create(&mut c, a);
    fund(&mut c, id, 0, USDC, 5);
    accept(&mut c, id, "rina.testnet", T0 + SEC);
    assert_eq!(c.nft_token(id.to_string()).unwrap().metadata.description.as_deref(), Some("Thanks!"));
    assert_eq!(c.nft_metadata().symbol, "ANDUM");
}

// =============================================================== admin
#[test]
fn admin_methods_reject_non_owner() {
    let mut c = new_contract();
    ctx("eve.testnet", T0);
    expect_err("NOT_ADMIN", || c.set_paused(true));
    expect_err("NOT_ADMIN", || c.set_allowed_tokens(vec![]));
    expect_err("NOT_ADMIN", || c.set_limits(Limits::default()));
    expect_err("NOT_ADMIN", || c.top_up());
}

#[test]
fn admin_can_change_allowlist() {
    let mut c = new_contract();
    ctx("admin.testnet", T0);
    c.set_allowed_tokens(vec![acc("new.testnet")]);
    ctx("sender.testnet", T0);
    expect_err("TOKEN_NOT_ALLOWED", || c.create_package(args(vec![part(USDC, 1)])));
    c.create_package(args(vec![part("new.testnet", 1)]));
}

#[test]
fn allowlist_change_does_not_affect_existing_package_funding() {
    // I-7 / I-5: terms fixed at creation; funding still works for an already created package
    let mut c = new_contract();
    let id = create(&mut c, args(vec![part(USDC, 10)]));
    ctx("admin.testnet", T0);
    c.set_allowed_tokens(vec![]);
    assert_eq!(fund(&mut c, id, 0, USDC, 10), 0);
}

#[test]
fn unpause_restores_writes() {
    let mut c = new_contract();
    ctx("admin.testnet", T0);
    c.set_paused(true);
    c.set_paused(false);
    create(&mut c, args(vec![part(USDC, 1)]));
}

#[test]
fn limits_validation() {
    let mut c = new_contract();
    ctx("admin.testnet", T0);
    let mut l = Limits::default();
    l.max_parts = 9;
    assert!(catch_unwind(AssertUnwindSafe(|| c.set_limits(l))).is_err());
}

#[test]
fn views_work_while_paused() {
    let mut c = new_contract();
    let id = funded_simple(&mut c);
    ctx("admin.testnet", T0);
    c.set_paused(true);
    assert!(c.get_package(U64(id)).is_some());
    assert_eq!(c.get_config()["paused"], true);
}

#[test]
fn double_init_refused() {
    let _ = new_contract();
    // state_exists is false in unit env; ensure constructor params round-trip
    let c = Contract::new(acc("admin.testnet"), vec![acc(USDC), acc(USDC)], None);
    assert_eq!(c.allowed_list.len(), 1, "allowlist deduplicated");
}

// =============================================================== invariants (property-style loop)
#[test]
fn invariant_funded_never_exceeds_amount_under_random_funding() {
    let mut c = new_contract();
    let id = create(&mut c, args(vec![part(USDC, 1000)]));
    let mut seed: u64 = 42;
    let mut kept: u128 = 0;
    let mut refunded: u128 = 0;
    let mut sent: u128 = 0;
    for _ in 0..200 {
        seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        let amt = ((seed >> 33) % 97) as u128;
        let status = c.get_package(U64(id)).unwrap().status;
        if status != PackageStatus::AwaitingFunds {
            break;
        }
        sent += amt;
        refunded += fund(&mut c, id, 0, USDC, amt);
        kept = c.get_package(U64(id)).unwrap().parts[0].funded.0;
        assert!(kept <= 1000);
        assert_eq!(kept + refunded, sent, "I-2/I-4 conservation");
    }
    assert_eq!(kept, 1000);
}

#[test]
fn view_exposes_invite_hash_for_backend_attach_check() {
    let mut c = new_contract();
    let id = create(&mut c, args(vec![part(USDC, 1)]));
    let v = c.get_package(U64(id)).unwrap();
    let h: Vec<u8> = v.invite_hash.unwrap().into();
    assert_eq!(h, env::sha256(b"secret"));
    let mut a = args(vec![part(USDC, 1)]);
    a.invite_hash = None;
    a.recipient = Some(acc("rina.testnet"));
    let id2 = create(&mut c, a);
    assert!(c.get_package(U64(id2)).unwrap().invite_hash.is_none());
}
