use near_sdk::json_types::{Base64VecU8, U128, U64};
use near_sdk::{near, AccountId};

pub const THEMES: [&str; 6] = ["none", "confetti", "gift", "balloons", "hearts", "gold"];
pub const NS_PER_DAY: u64 = 86_400_000_000_000;

#[near(serializers=[json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Limits {
    pub max_parts: u8,
    pub max_open_per_sender: u32,
    pub max_note: u32,
    pub max_approvers: u8,
    pub max_accept_window_days: u32,
}
impl Default for Limits {
    fn default() -> Self {
        Self { max_parts: 8, max_open_per_sender: 50, max_note: 140, max_approvers: 5, max_accept_window_days: 90 }
    }
}

#[near(serializers=[json, borsh])]
#[derive(Clone, Debug, PartialEq, Copy)]
pub enum PackageStatus {
    #[serde(rename = "AWAITING_FUNDS")] AwaitingFunds,
    #[serde(rename = "FUNDED")] Funded,
    #[serde(rename = "ACCEPTED")] Accepted,
    #[serde(rename = "RECLAIMED")] Reclaimed,
}

#[near(serializers=[json, borsh])]
#[derive(Clone, Debug, PartialEq, Copy)]
pub enum PartState {
    Locked,
    Pending { attempt_id: u64 },
    Taken { taken_ns: u64 },
}

#[near(serializers=[json, borsh])]
#[derive(Clone, Debug)]
pub struct Part {
    pub token: AccountId,
    pub amount: u128,
    pub funded: u128,
    pub unlock_ns: Option<u64>,
    pub approvers: Vec<AccountId>,
    pub threshold: u8,
    pub approvals: Vec<AccountId>,
    pub state: PartState,
    pub attempts: u64,
    /// amount already sent back to the sender by reclaim
    pub reclaimed: u128,
}

#[near(serializers=[json, borsh])]
#[derive(Clone, Debug)]
pub struct Package {
    pub id: u64,
    pub sender: AccountId,
    pub recipient: Option<AccountId>,
    pub owner: Option<AccountId>,
    pub invite_hash: Option<[u8; 32]>,
    pub accept_by_ns: u64,
    pub created_ns: u64,
    pub accepted_ns: Option<u64>,
    pub status: PackageStatus,
    pub note: Option<String>,
    pub theme: String,
    pub parts: Vec<Part>,
}

// ---------- inputs ----------
#[near(serializers=[json])]
#[derive(Clone, Debug)]
pub struct PartInput {
    pub token: AccountId,
    pub amount: U128,
    pub unlock_ns: Option<U64>,
    pub approvers: Option<Vec<AccountId>>,
    pub approval_threshold: Option<u8>,
}

#[near(serializers=[json])]
#[derive(Clone, Debug)]
pub struct CreatePackageArgs {
    pub parts: Vec<PartInput>,
    pub accept_by_ns: U64,
    pub recipient: Option<AccountId>,
    pub invite_hash: Option<Base64VecU8>,
    pub note: Option<String>,
    pub theme: Option<String>,
}

#[near(serializers=[json])]
pub struct FundMsg {
    pub package_id: U64,
    pub part_id: u8,
}

// ---------- views ----------
#[near(serializers=[json])]
#[derive(Clone, Debug, PartialEq)]
pub enum PartViewState { LOCKED, PENDING, TAKEN }

#[near(serializers=[json])]
#[derive(Clone, Debug)]
pub struct PartView {
    pub part_id: u8,
    pub token: AccountId,
    pub amount: U128,
    pub funded: U128,
    pub unlock_ns: Option<U64>,
    pub approvers: Vec<AccountId>,
    pub threshold: u8,
    pub approvals: Vec<AccountId>,
    pub approved: bool,
    pub state: PartViewState,
    pub status: String,
    pub reason: Option<String>,
    pub taken_ns: Option<U64>,
}

#[near(serializers=[json])]
#[derive(Clone, Debug)]
pub struct PackageView {
    pub id: U64,
    pub sender: AccountId,
    pub recipient: Option<AccountId>,
    pub owner: Option<AccountId>,
    /// base64 sha256 of the invite secret (public by design; lets the backend verify /attach)
    pub invite_hash: Option<Base64VecU8>,
    pub status: PackageStatus,
    pub note: Option<String>,
    pub theme: String,
    pub accept_by_ns: U64,
    pub created_ns: U64,
    pub accepted_ns: Option<U64>,
    pub parts: Vec<PartView>,
}

#[near(serializers=[json])]
pub struct StorageReport {
    pub balance: U128,
    pub locked_for_storage: U128,
    pub available: U128,
    pub packages: U64,
    pub bytes_used: U64,
}

// ---------- NFT (NEP-171 / 177) ----------
#[near(serializers=[json])]
#[derive(Clone, Debug)]
pub struct NFTContractMetadata {
    pub spec: String,
    pub name: String,
    pub symbol: String,
    pub icon: Option<String>,
    pub base_uri: Option<String>,
    pub reference: Option<String>,
    pub reference_hash: Option<Base64VecU8>,
}

#[near(serializers=[json])]
#[derive(Clone, Debug)]
pub struct TokenMetadata {
    pub title: Option<String>,
    pub description: Option<String>,
    pub media: Option<String>,
    pub copies: Option<u64>,
    pub reference: Option<String>,
}

#[near(serializers=[json])]
#[derive(Clone, Debug)]
pub struct JsonToken {
    pub token_id: String,
    pub owner_id: AccountId,
    pub metadata: TokenMetadata,
}
