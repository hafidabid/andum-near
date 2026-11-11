//! Sandbox integration: the real compiled wasm for core + mock-ft interacting through real cross-contract calls.
//! Build first:  cargo build --release --target wasm32-unknown-unknown
//! Run:          cargo test -p andum-integration -- --test-threads=1
use near_workspaces::{network::Sandbox, Account, Contract, Worker};
use serde_json::{json, Value};

const CORE_WASM: &str = "../target/wasm32-unknown-unknown/release/andum_core.wasm";
const FT_WASM: &str = "../target/wasm32-unknown-unknown/release/andum_mock_ft.wasm";
const DAY: u64 = 86_400_000_000_000;

struct Env { worker: Worker<Sandbox>, core: Contract, usdc: Contract, admin: Account, sender: Account, rina: Account, boss: Account }

async fn setup() -> anyhow::Result<Env> {
    let worker = near_workspaces::sandbox().await?;
    let root = worker.root_account()?;
    let admin = root.create_subaccount("admin").initial_balance(near_workspaces::types::NearToken::from_near(10)).transact().await?.into_result()?;
    let core = root.create_subaccount("core").initial_balance(near_workspaces::types::NearToken::from_near(50)).transact().await?.into_result()?;
    let usdc = root.create_subaccount("usdc").initial_balance(near_workspaces::types::NearToken::from_near(10)).transact().await?.into_result()?;
    let core = core.deploy(&std::fs::read(CORE_WASM)?).await?.into_result()?;
    let usdc = usdc.deploy(&std::fs::read(FT_WASM)?).await?.into_result()?;
    core.call("new").args_json(json!({"owner": admin.id(), "allowed_tokens": [usdc.id()], "limits": null})).transact().await?.into_result()?;
    usdc.call("new").args_json(json!({"owner_id": admin.id(), "name": "USD", "symbol": "USDC", "decimals": 6, "minters": [], "per_call_cap": "10000000000", "daily_cap": "100000000000"})).transact().await?.into_result()?;
    // core must be registered with the token to receive funding (deploy script step)
    usdc.call("storage_deposit").args_json(json!({"account_id": core.id(), "registration_only": true})).deposit(near_workspaces::types::NearToken::from_millinear(10)).transact().await?.into_result()?;
    let mk = |n: &'static str| root.create_subaccount(n).initial_balance(near_workspaces::types::NearToken::from_near(5)).transact();
    let sender = mk("sender").await?.into_result()?; let rina = mk("rina").await?.into_result()?; let boss = mk("boss").await?.into_result()?;
    sender.call(usdc.id(), "ft_mint").args_json(json!({"account_id": sender.id(), "amount": "5000000000"})).transact().await?.into_result()?;
    Ok(Env { worker, core, usdc, admin, sender, rina, boss })
}

async fn now_ns(e: &Env) -> u64 { e.worker.view_block().await.unwrap().timestamp() }
fn b64(b: &[u8]) -> String { use std::fmt::Write; let t = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"; let mut s = String::new(); for c in b.chunks(3) { let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32; let _ = write!(s, "{}{}", t[(n >> 18) as usize & 63] as char, t[(n >> 12) as usize & 63] as char); s.push(if c.len() > 1 { t[(n >> 6) as usize & 63] as char } else { '=' }); s.push(if c.len() > 2 { t[n as usize & 63] as char } else { '=' }); } s }
fn sha256(data: &[u8]) -> Vec<u8> { use std::process::{Command, Stdio}; use std::io::Write; let mut c = Command::new("shasum").args(["-a", "256"]).stdin(Stdio::piped()).stdout(Stdio::piped()).spawn().unwrap(); c.stdin.as_mut().unwrap().write_all(data).unwrap(); let out = c.wait_with_output().unwrap(); let hex = String::from_utf8(out.stdout).unwrap(); (0..32).map(|i| u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16).unwrap()).collect() }

async fn bal(e: &Env, who: &Account) -> u128 { e.usdc.view("ft_balance_of").args_json(json!({"account_id": who.id()})).await.unwrap().json::<String>().unwrap().parse().unwrap() }
async fn pkg(e: &Env, id: &str) -> Value { e.core.view("get_package").args_json(json!({"package_id": id})).await.unwrap().json().unwrap() }
fn failure_text(r: &near_workspaces::result::ExecutionFinalResult) -> String { let t = format!("{:?}", r.clone().into_result().err()); eprintln!("FAILURE_TEXT: {t}"); t }

async fn create(e: &Env, parts: Value, secret: &[u8]) -> String {
    let t = now_ns(e).await;
    let r = e.sender.call(e.core.id(), "create_package").args_json(json!({"args": {"parts": parts, "accept_by_ns": (t + 3 * DAY).to_string(), "invite_hash": b64(&sha256(secret))}})).transact().await.unwrap();
    r.json::<String>().unwrap()
}
async fn fund(e: &Env, id: &str, part: u8, amount: &str) -> near_workspaces::result::ExecutionFinalResult {
    e.sender.call(e.usdc.id(), "ft_transfer_call").args_json(json!({"receiver_id": e.core.id(), "amount": amount, "msg": json!({"package_id": id, "part_id": part}).to_string()})).deposit(near_workspaces::types::NearToken::from_yoctonear(1)).max_gas().transact().await.unwrap()
}

#[tokio::test]
async fn funding_moves_real_tokens_and_overfunding_is_refunded() -> anyhow::Result<()> {
    let e = setup().await?;
    let id = create(&e, json!([{"token": e.usdc.id(), "amount": "1000000"}]), b"secret").await;
    let before = bal(&e, &e.sender).await;
    let r = fund(&e, &id, 0, "1500000").await; // 500000 too much
    assert!(r.is_success(), "{:?}", r);
    assert_eq!(bal(&e, &e.sender).await, before - 1_000_000, "excess was refunded by the token");
    assert_eq!(bal(&e, e.core.as_account()).await, 1_000_000);
    assert_eq!(pkg(&e, &id).await["status"], "FUNDED");
    Ok(())
}

#[tokio::test]
async fn wrong_funder_is_refunded_in_full_and_nothing_changes() -> anyhow::Result<()> {
    let e = setup().await?;
    let id = create(&e, json!([{"token": e.usdc.id(), "amount": "1000000"}]), b"secret").await;
    e.rina.call(e.usdc.id(), "ft_mint").args_json(json!({"account_id": e.rina.id(), "amount": "1000000"})).transact().await?.into_result()?;
    let r = e.rina.call(e.usdc.id(), "ft_transfer_call").args_json(json!({"receiver_id": e.core.id(), "amount": "1000000", "msg": json!({"package_id": id, "part_id": 0}).to_string()})).deposit(near_workspaces::types::NearToken::from_yoctonear(1)).max_gas().transact().await?;
    let _ = r; // the transfer call itself succeeds; core panicked so the token refunded everything
    assert_eq!(bal(&e, &e.rina).await, 1_000_000);
    assert_eq!(bal(&e, e.core.as_account()).await, 0);
    assert_eq!(pkg(&e, &id).await["status"], "AWAITING_FUNDS");
    Ok(())
}

#[tokio::test]
async fn full_lifecycle_accept_claim_pays_exactly_once() -> anyhow::Result<()> {
    let e = setup().await?;
    let secret = b"top-secret-bytes";
    let id = create(&e, json!([{"token": e.usdc.id(), "amount": "2000000"}]), secret).await;
    assert!(fund(&e, &id, 0, "2000000").await.is_success());
    // wrong secret
    let bad = e.rina.call(e.core.id(), "accept_package").args_json(json!({"package_id": id, "invite_secret": b64(b"nope")})).transact().await?;
    assert!(failure_text(&bad).contains("ANDUM_ERR:INVITE_SECRET_INVALID"), "{}", failure_text(&bad));
    // right secret
    assert!(e.rina.call(e.core.id(), "accept_package").args_json(json!({"package_id": id, "invite_secret": b64(secret)})).max_gas().transact().await?.is_success());
    assert_eq!(pkg(&e, &id).await["owner"], e.rina.id().to_string());
    // stranger cannot claim
    let s = e.sender.call(e.core.id(), "claim").args_json(json!({"package_id": id, "part_id": 0})).max_gas().transact().await?;
    assert!(failure_text(&s).contains("ANDUM_ERR:NOT_PASS_OWNER"));
    // owner claims: tokens really arrive, state is TAKEN only after the callback
    let c = e.rina.call(e.core.id(), "claim").args_json(json!({"package_id": id, "part_id": 0})).max_gas().transact().await?;
    assert!(c.is_success(), "{:?}", c);
    assert_eq!(bal(&e, &e.rina).await, 2_000_000);
    assert_eq!(bal(&e, e.core.as_account()).await, 0);
    assert_eq!(pkg(&e, &id).await["parts"][0]["status"], "TAKEN");
    // second claim refused, nothing more paid
    let again = e.rina.call(e.core.id(), "claim").args_json(json!({"package_id": id, "part_id": 0})).max_gas().transact().await?;
    assert!(failure_text(&again).contains("ANDUM_ERR:ALREADY_TAKEN"));
    assert_eq!(bal(&e, &e.rina).await, 2_000_000);
    Ok(())
}

#[tokio::test]
async fn approval_and_time_gate() -> anyhow::Result<()> {
    let e = setup().await?;
    let t = now_ns(&e).await;
    let id = create(&e, json!([{"token": e.usdc.id(), "amount": "3000000", "unlock_ns": (t + 6_000_000_000u64).to_string(), "approvers": [e.boss.id()]}]), b"s").await;
    assert!(fund(&e, &id, 0, "3000000").await.is_success());
    assert!(e.rina.call(e.core.id(), "accept_package").args_json(json!({"package_id": id, "invite_secret": b64(b"s")})).max_gas().transact().await?.is_success());
    let early = e.rina.call(e.core.id(), "claim").args_json(json!({"package_id": id, "part_id": 0})).max_gas().transact().await?;
    assert!(failure_text(&early).contains("ANDUM_ERR:TIME_NOT_REACHED"));
    // only the named approver can approve
    let stranger = e.sender.call(e.core.id(), "approve_part").args_json(json!({"package_id": id, "part_id": 0})).transact().await?;
    assert!(failure_text(&stranger).contains("ANDUM_ERR:NOT_APPROVER"));
    assert!(e.boss.call(e.core.id(), "approve_part").args_json(json!({"package_id": id, "part_id": 0})).transact().await?.is_success());
    let v = pkg(&e, &id).await;
    assert_eq!(v["parts"][0]["approved"], true);
    tokio::time::sleep(std::time::Duration::from_secs(7)).await;
    e.worker.fast_forward(10).await?;
    let ok = e.rina.call(e.core.id(), "claim").args_json(json!({"package_id": id, "part_id": 0})).max_gas().transact().await?;
    assert!(ok.is_success(), "{:?}", ok);
    assert_eq!(bal(&e, &e.rina).await, 3_000_000);
    Ok(())
}

#[tokio::test]
async fn nft_pass_is_non_transferable_on_the_real_contract() -> anyhow::Result<()> {
    let e = setup().await?;
    let id = create(&e, json!([{"token": e.usdc.id(), "amount": "1"}]), b"s").await;
    assert!(fund(&e, &id, 0, "1").await.is_success());
    assert!(e.rina.call(e.core.id(), "accept_package").args_json(json!({"package_id": id, "invite_secret": b64(b"s")})).max_gas().transact().await?.is_success());
    let t: Value = e.core.view("nft_token").args_json(json!({"token_id": id})).await?.json()?;
    assert_eq!(t["owner_id"], e.rina.id().to_string());
    let r = e.rina.call(e.core.id(), "nft_transfer").args_json(json!({"receiver_id": e.boss.id(), "token_id": id})).deposit(near_workspaces::types::NearToken::from_yoctonear(1)).transact().await?;
    assert!(failure_text(&r).contains("ANDUM_ERR:PASS_NOT_TRANSFERABLE"));
    Ok(())
}

#[tokio::test]
async fn admin_cannot_move_funds_and_non_admin_cannot_pause() -> anyhow::Result<()> {
    let e = setup().await?;
    let id = create(&e, json!([{"token": e.usdc.id(), "amount": "1000"}]), b"s").await;
    assert!(fund(&e, &id, 0, "1000").await.is_success());
    let r = e.rina.call(e.core.id(), "set_paused").args_json(json!({"paused": true})).transact().await?;
    assert!(failure_text(&r).contains("ANDUM_ERR:NOT_ADMIN"));
    // there is no method that can withdraw: calling plausible names fails with method-not-found
    for m in ["withdraw", "rescue_tokens", "transfer_out", "ft_transfer"] {
        let w = e.admin.call(e.core.id(), m).args_json(json!({"receiver_id": e.admin.id(), "amount": "1000"})).max_gas().transact().await?;
        assert!(w.into_result().is_err(), "{m} must not exist");
    }
    assert_eq!(bal(&e, e.core.as_account()).await, 1000);
    Ok(())
}

#[tokio::test]
async fn reclaim_returns_tokens_to_the_sender_after_deadline() -> anyhow::Result<()> {
    let e = setup().await?;
    let t = now_ns(&e).await;
    let r = e.sender.call(e.core.id(), "create_package").args_json(json!({"args": {"parts": [{"token": e.usdc.id(), "amount": "700000"}], "accept_by_ns": (t + 5_000_000_000u64).to_string(), "invite_hash": b64(&sha256(b"s"))}})).transact().await?;
    let id: String = r.json()?;
    assert!(fund(&e, &id, 0, "700000").await.is_success());
    let early = e.sender.call(e.core.id(), "reclaim_unaccepted").args_json(json!({"package_id": id})).max_gas().transact().await?;
    assert!(failure_text(&early).contains("ANDUM_ERR:NOT_RECLAIMABLE"));
    tokio::time::sleep(std::time::Duration::from_secs(7)).await;
    e.worker.fast_forward(10).await?;
    let before = bal(&e, &e.sender).await;
    let ok = e.sender.call(e.core.id(), "reclaim_unaccepted").args_json(json!({"package_id": id})).max_gas().transact().await?;
    assert!(ok.is_success(), "{:?}", ok);
    assert_eq!(bal(&e, &e.sender).await, before + 700_000);
    assert_eq!(pkg(&e, &id).await["status"], "RECLAIMED");
    Ok(())
}
