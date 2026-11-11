//! NEP-297 events (ANDUM-PLAN §3.6).
use near_sdk::{env, serde_json::{json, Value}};

pub fn emit(event: &str, data: Value) {
    let s = json!({"standard":"andum","version":"1.0.0","event":event,"data":[data]});
    env::log_str(&format!("EVENT_JSON:{s}"));
}

pub fn emit_nft_mint(owner: &str, token_id: &str) {
    let s = json!({"standard":"nep171","version":"1.2.0","event":"nft_mint",
        "data":[{"owner_id":owner,"token_ids":[token_id]}]});
    env::log_str(&format!("EVENT_JSON:{s}"));
}
