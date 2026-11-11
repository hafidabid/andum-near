//! Error codes (ANDUM-PLAN §3.5). Every panic reads `ANDUM_ERR:<CODE>`.
use near_sdk::env;

pub const PAUSED: &str = "PAUSED";
pub const NOT_ADMIN: &str = "NOT_ADMIN";
pub const TOKEN_NOT_ALLOWED: &str = "TOKEN_NOT_ALLOWED";
pub const INVALID_PARTS: &str = "INVALID_PARTS";
pub const INVALID_AMOUNT: &str = "INVALID_AMOUNT";
pub const INVALID_RULE: &str = "INVALID_RULE";
pub const UNLOCK_IN_PAST: &str = "UNLOCK_IN_PAST";
pub const INVALID_EXPIRY: &str = "INVALID_EXPIRY";
pub const NOTE_TOO_LONG: &str = "NOTE_TOO_LONG";
pub const INVALID_THEME: &str = "INVALID_THEME";
pub const INVALID_APPROVERS: &str = "INVALID_APPROVERS";
pub const RECEIVER_IS_APPROVER: &str = "RECEIVER_IS_APPROVER";
pub const LIMIT_EXCEEDED: &str = "LIMIT_EXCEEDED";
pub const PACKAGE_NOT_FOUND: &str = "PACKAGE_NOT_FOUND";
pub const PART_NOT_FOUND: &str = "PART_NOT_FOUND";
pub const NOT_SENDER: &str = "NOT_SENDER";
pub const NOT_APPROVER: &str = "NOT_APPROVER";
pub const NOT_PASS_OWNER: &str = "NOT_PASS_OWNER";
pub const WRONG_TOKEN: &str = "WRONG_TOKEN";
pub const WRONG_SENDER: &str = "WRONG_SENDER";
pub const BAD_MSG: &str = "BAD_MSG";
pub const PACKAGE_NOT_ACTIVE: &str = "PACKAGE_NOT_ACTIVE";
pub const ALREADY_ACCEPTED: &str = "ALREADY_ACCEPTED";
pub const INVITE_EXPIRED: &str = "INVITE_EXPIRED";
pub const INVITE_SECRET_INVALID: &str = "INVITE_SECRET_INVALID";
pub const NOT_INVITED_ACCOUNT: &str = "NOT_INVITED_ACCOUNT";
pub const TIME_NOT_REACHED: &str = "TIME_NOT_REACHED";
pub const APPROVAL_MISSING: &str = "APPROVAL_MISSING";
pub const ALREADY_TAKEN: &str = "ALREADY_TAKEN";
pub const TRANSFER_PENDING: &str = "TRANSFER_PENDING";
pub const NOT_RECLAIMABLE: &str = "NOT_RECLAIMABLE";
pub const ALREADY_RECLAIMED: &str = "ALREADY_RECLAIMED";
pub const PASS_NOT_TRANSFERABLE: &str = "PASS_NOT_TRANSFERABLE";
pub const STORAGE_RESERVE_LOW: &str = "STORAGE_RESERVE_LOW";

/// Abort the call with a structured error.
pub fn err(code: &str) -> ! {
    env::panic_str(&format!("ANDUM_ERR:{code}"))
}
