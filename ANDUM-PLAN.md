# Andum: Build Plan (Smart Contracts, Backend, Multichain Demo)

| | |
|---|---|
| Document | `ANDUM-PLAN.md` (companion: `ANDUM-TEST.md`) |
| Version | 1.0, 11 Nov 2026 |
| Audience | AI coding agents working in parallel, with a human in the loop |
| Event | NEAR HACKATHON. Development ends **14 Nov 2026 23:59 UTC**. Judging 16 to 18 Nov. |
| Status | Design only. Nothing in this document has been built, deployed or tested. |

---

## 0. How to use this document

### 0.1 For an agent

1. Read sections 1 to 3 completely. They are short and they bind everyone.
2. Find your workstream in section 9 and read only the sections it points to.
3. Everything in section 3 (**Interface Freeze**) is a contract between workstreams. Do not change it on your own. If you think it is wrong, open a change request (section 9.6) and keep working against the current version until a human approves the change.
4. Anything marked **[VERIFY]** is a fact that was not confirmed when this document was written (versions, API shapes, third-party behaviour). Check it against primary documentation or a quick experiment before relying on it. Record the result in `docs/VERIFY-LOG.md`.
5. Anything marked **[HUMAN]** needs a person (keys, accounts, funds, approvals, publishing). Stop and ask. Do not invent credentials, do not create accounts on the user's behalf, do not publish anything.
6. Write tests from `ANDUM-TEST.md` as you go. A workstream is not done until its test IDs pass.
7. Never commit secrets. Use `.env.example` with placeholders only.

### 0.2 For the human

Gates where an agent will stop and wait for you are listed in section 9.5. Everything else should proceed without you.

### 0.3 Decisions already made by the product owner

| ID | Decision |
|---|---|
| D-01 | **NEAR testnet is the home chain.** The product (packages, NFT, approvals, claims) lives in a Rust contract on NEAR. |
| D-02 | **Ethereum Sepolia and Base Sepolia are a multichain demonstration only.** They carry mock tokens and a small gateway contract. No package logic lives on EVM. |
| D-03 | **Mock tokens everywhere.** We deploy our own stablecoin, gold and stock tokens on NEAR, Ethereum Sepolia and Base Sepolia, with an open faucet. We do not use Circle test USDC or any real asset. |
| D-04 | **Gasless for users.** Users never pay gas. A relayer pays it (NEP-366 on NEAR, ERC-2771 on EVM). |
| D-05 | **Login with email or Google** through Privy or Web3Auth if one can sign for NEAR. Otherwise fall back (section 8.6). Whether they can is spike S-02. |
| D-06 | **Work is done by parallel agents with a human in the loop.** |
| D-08 | **Approvers are a group, not just one person.** A part can name 1 to 5 approvers and a threshold (for example 2 of 3). One approver is the default. The sender may name themselves. |
| D-09 | **Every package can carry an opening moment**: an animation theme chosen by the sender (plain, celebrate, surprise, balloons, thank you, milestone) and a short note of at most 140 characters. Both are stored on chain and are public. The animation itself is drawn in the web app. |
| D-10 | **The send link is customizable.** The sender picks a readable link name (for example `andum.app/p/rina-audit-bonus`), a title for the link page and chat preview, and whether the amount shows in the chat preview (off by default). The link is an alias that lives in the backend only. It never replaces the invite secret or the email check. |
| D-07 | The public pages must not say "testnet" up front. The network name appears when a wallet is connected. (Landing page and prototype already follow this.) |

### 0.4 Non-goals

- Mainnet, real money, audits, legal or compliance review.
- A real bridge. The "bridge" here is a trusted relayer that burns on one chain and mints on another, for demonstration. It is labelled as such in code and docs. A production version would use NEAR Intents (section 7.8).
- Package logic on EVM chains.
- Transferable or tradable packages (the NFT is non-transferable while a package is active).
- Refund rules for a silent approver. The product decision is still open. The contract leaves such a part closed forever (documented in `ANDUM-TEST.md` as a known limitation, test C-APPROVE-90).

---

## 1. Product scope

### 1.1 One-paragraph product

Andum sends money and assets in one **package**. The sender funds it up front. Each **part** of the package opens on its own rule: right away, on a date, or on a date plus the approval of a named person. The receiver sees the funds before accepting, sees why each closed part is closed, is told by email when a part opens, and takes it with one tap. The package is an NFT that stays in the receiver's account until the last part is taken. Nobody pays gas.

### 1.2 Priority levels

| Level | Meaning | Cut rule |
|---|---|---|
| **P0** | Without it there is no demo | Never cut |
| **P1** | Makes the demo credible | Cut only if P0 is late by more than 8 hours at the end of Day 2 |
| **P2** | Multichain showcase | First to cut |

### 1.3 Requirements

Test IDs referenced here are defined in `ANDUM-TEST.md`.

| ID | Requirement | Pri |
|---|---|---|
| **C-01** | Sender creates a package of 1 to 8 parts. Each part has a token (from the allowlist), an amount, an optional unlock time and an optional approver group (1 to 5 accounts with a threshold, default 1). Approvers require an unlock time. | P0 |
| **C-02** | Sender funds each part by `ft_transfer_call`. The contract accepts only exact funding from the sender, from the right token contract, and refunds any excess. | P0 |
| **C-03** | A package becomes `FUNDED` when every part is fully funded. After creation no term can change. | P0 |
| **C-04** | Receiver accepts with an invite secret (or as a fixed named account). Accepting mints exactly one non-transferable NFT to the receiver and registers the receiver with each token. | P0 |
| **C-05** | Only a named approver can approve a part, once each. A part is approved when the number of distinct approvals reaches its threshold. The sender may be an approver; the receiver may not. Approval is allowed before the date. | P0 |
| **L-01** | Custom send link: unique slug (3 to 32 characters), title (60 characters), amount-in-preview switch, live availability check, changes allowed until the package is accepted, old name redirects for 24 hours, chat preview (title, description, image) generated by the server. | P1 |
| **C-12** | A package carries an optional `theme` (from a fixed list) and an optional `note` (140 characters). They are shown in views, events and the NFT metadata. | P1 |
| **O-01** | The receiver sees an opening moment (theme animation and note) after accepting, and a smaller burst after each take. The sender can preview it while building. | P1 |
| **C-06** | Only the NFT owner can take a part. A part opens only when its date has passed and any approval is in. A taken part can never be taken again. Two parallel takes pay once. | P0 |
| **C-07** | The sender can take back an unaccepted package after its acceptance deadline. | P0 |
| **C-08** | The package NFT follows NEP-171, NEP-177 and NEP-181 for display, and refuses transfers while any part is not taken. | P1 |
| **C-09** | Every state change emits a structured event (NEP-297). | P0 |
| **C-10** | The contract admin can pause, manage the token allowlist, top up storage and upgrade. The admin has **no** method that moves user funds. | P0 |
| **C-11** | Views return a computed status and a reason code for each part. | P0 |
| **F-01** | Mock fungible tokens (NEP-141) with an open, capped faucet. | P0 |
| **F-02** | Minter role for the bridge: mint, burn, and mint-and-call. | P2 |
| **B-01** | NEAR bridge contract: `bridge_in` (relayer only, idempotent) and outbound burn via `ft_transfer_call`. | P2 |
| **E-01** | Mock ERC-20 tokens on Ethereum Sepolia and Base Sepolia with open, capped faucet and permit. | P2 |
| **E-02** | EVM gateway: deposit-for-NEAR (burn) and release-from-NEAR (mint, relayer only, replay-protected). | P2 |
| **E-03** | ERC-2771 forwarder so the relayer can pay EVM gas. | P2 |
| **A-01** | Login and session. Each user maps to one NEAR account. | P0 |
| **A-02** | Account bootstrap: create and fund the account so it can hold tokens and attach 1 yoctoNEAR. | P0 |
| **A-03** | Invites: random secret, email verification by one-time code, single use, expiry. | P0 |
| **A-04** | Relayer: accepts a signed delegate action, applies a policy, submits it, reports the result. | P0 |
| **A-05** | Package read API backed by chain state (cache plus reconcile). | P0 |
| **A-06** | Notifier: email when a part opens, once per part, state re-checked before sending. | P1 |
| **A-07** | Faucet API for NEAR and EVM mock tokens. | P0 (NEAR), P2 (EVM) |
| **A-08** | Bridge worker: EVM to NEAR and NEAR to EVM, idempotent, confirmation-aware. | P2 |
| **A-09** | Live updates to the web app (server-sent events). | P1 |
| **U-01** | Web app implements the flows in `andum-app-prototype.html` against the real backend. | P0 |
| **U-02** | Landing page links to the app. | P1 |
| **N-01** | Gasless: a user's NEAR balance never decreases by more than 1 yoctoNEAR per funding transfer, and never pays gas. | P0 |
| **N-02** | A fresh clone can be set up and run from the README in under 30 minutes. | P0 |

### 1.4 Demo script (90 seconds)

The demo is the acceptance test of last resort. Steps map to test E2E-01.

1. Sender mints test USDC and gold from the faucet.
2. Sender builds a package for Rina: 200 USDC right away, 800 USDC on a date plus approval, 1.5 g gold on a later date. Short times are used (90 s, 150 s, 210 s).
3. Sender funds it (two wallet confirmations, no gas).
4. Rina opens the link on a second browser, verifies her email, accepts, sees the funds before accepting.
5. Rina takes Part 1. Rina tries Part 2: refused with `TIME_NOT_REACHED` or `APPROVAL_MISSING` and a readable reason.
6. Approver approves Part 2. Email arrives. Rina takes Part 2.
7. Rina sends part of the money to Base Sepolia. It arrives (P2).

---

## 2. Architecture

### 2.1 Components

```mermaid
flowchart LR
  subgraph Users
    S[Sender]:::u
    R[Receiver]:::u
    A[Approver]:::u
  end
  subgraph Web["Web app (Next.js)"]
    UI[UI + Signer abstraction]
  end
  subgraph Backend["Backend (TypeScript)"]
    API[API gateway]
    REL[Relayer + policy engine]
    IDX[Reconciler / indexer]
    NOT[Notifier]
    BR[Bridge worker]
    FAU[Faucet]
    DB[(Postgres)]
    Q[(Redis queue)]
  end
  subgraph NEAR["NEAR testnet (home chain)"]
    CORE[andum core\nvault + tranches + NFT]
    FT[mock-ft x11]
    BRG[bridge]
  end
  subgraph EVM["Ethereum Sepolia and Base Sepolia (demo)"]
    GW[AndumGateway]
    ERC[MockERC20 x11]
    FWD[ERC2771Forwarder]
  end
  EMAIL[Email provider]
  AUTH[Privy or Web3Auth]

  S & R & A --> UI
  UI --> AUTH
  UI -->|REST + SSE| API
  API --> REL --> CORE
  REL --> FT
  API --> DB
  IDX --> CORE
  IDX --> DB
  NOT --> DB
  NOT --> EMAIL
  FAU --> FT
  FAU --> ERC
  BR --> BRG
  BR --> GW
  BRG --> FT
  GW --> ERC
  REL --> FWD --> GW
  classDef u fill:#eee,stroke:#999
```

### 2.2 Trust model (read this before designing anything)

| Actor | Can | Cannot |
|---|---|---|
| Sender | Create, fund, reclaim if unaccepted past deadline | Change terms, redirect, take a part |
| Receiver (NFT owner) | Accept, take parts whose rules are met | Take early, take twice, transfer the NFT |
| Approver | Approve parts they are named on | Move money, change the receiver |
| Relayer | Submit users' signed actions and pay gas | Change a signed action, sign for a user |
| Backend | Hold invite secrets, release one after email verification, send emails | Move package funds, approve, take |
| Contract admin | Pause, allowlist tokens, top up, upgrade | Move user funds by any method (invariant I-1) |
| Bridge relayer (demo) | Mint and burn mock tokens through the bridge | Anything on the core contract |

Known trust points that are accepted for the hackathon and must be written in the README: the admin can upgrade the contract; the bridge relayer is trusted; the backend holds invite secrets; mock tokens have no value.

### 2.3 Networks

| Network | Id | Role | Notes |
|---|---|---|---|
| NEAR testnet | `testnet` | Home chain | RPC default `https://test.rpc.fastnear.com`. **[VERIFY]** availability and rate limits. Keep a second URL configured. |
| Ethereum Sepolia | `11155111` | Demo | Explorer `https://sepolia.etherscan.io`. Relayer needs test ETH. **[HUMAN]** |
| Base Sepolia | `84532` | Demo | Explorer `https://sepolia.basescan.org`. Relayer needs test ETH. **[HUMAN]** |

### 2.4 Account layout on NEAR

`ROOT` is a human-created top-level testnet account, for example `andum-hack.testnet`. **[HUMAN]** creates it and funds it. All other accounts are subaccounts created by a deploy script.

| Account | Purpose |
|---|---|
| `core.ROOT` | Andum core contract |
| `bridge.ROOT` | Bridge contract (P2) |
| `usdc.ROOT`, `idrx.ROOT`, `myr.ROOT`, `sgd.ROOT`, `thb.ROOT`, `eur.ROOT`, `jpy.ROOT`, `xau.ROOT`, `aapl.ROOT`, `nvda.ROOT`, `tsla.ROOT` | Mock fungible tokens |
| `relayer.ROOT` | Pays gas for delegate actions and tops up user accounts. Holds a funded access key. |
| `bridgeworker.ROOT` | Calls `bridge_in` (P2) |
| `admin.ROOT` | Contract admin (owner) |

Storage is paid by the contract's own balance. `core.ROOT` must hold at least **20 NEAR** during development **[HUMAN]**. See section 5.9 for the formula.

---

## 3. Interface Freeze

Everything in this section is the shared contract between workstreams. It is the first deliverable (workstream WS-0, section 9). Put it in `packages/shared` as code so every workstream imports the same definitions.

### 3.1 Units and conventions

- **Amounts**: unsigned integers in the token's smallest unit, serialised as **decimal strings** in JSON (`"800000000"`). Never floats.
- **Decimals**: every mock token uses **6 decimals** on NEAR and EVM. (Real IDRX uses 2; we use 6 to keep one conversion.)
- **Time**: NEAR contract times are **nanoseconds** since the Unix epoch (`u64`, serialised as decimal string, suffix `_ns`). Backend and API times are ISO 8601 UTC strings or milliseconds `_ms`, always with the suffix. Never mix.
- **IDs**: `package_id` is a decimal string (u64). `part_id` is a small integer starting at 0.
- **Accounts**: NEAR account ids as strings. EVM addresses are lowercase `0x` hex with EIP-55 checksum only when displayed.
- **Errors**: a contract panics with a message beginning `ANDUM_ERR:` followed by a code from 3.5. The backend maps it to an API error (3.6).

### 3.2 Asset registry (`packages/shared/assets.json`)

```json
[
  {"id":"usdc","symbol":"USDC","name":"US dollar stablecoin","kind":"currency","decimals":6,"bridgeable":true,
   "near":"usdc.ROOT","evm":{"sepolia":"0x...","baseSepolia":"0x..."},"faucet":{"perCall":"10000000000","daily":"100000000000"}},
  {"id":"idrx","symbol":"IDRX","name":"Indonesian rupiah","kind":"currency","decimals":6,"bridgeable":true},
  {"id":"myr","symbol":"MYR","name":"Malaysian ringgit","kind":"currency","decimals":6,"bridgeable":true},
  {"id":"sgd","symbol":"SGD","name":"Singapore dollar","kind":"currency","decimals":6,"bridgeable":true},
  {"id":"thb","symbol":"THB","name":"Thai baht","kind":"currency","decimals":6,"bridgeable":true},
  {"id":"eur","symbol":"EUR","name":"Euro","kind":"currency","decimals":6,"bridgeable":true},
  {"id":"jpy","symbol":"JPY","name":"Japanese yen","kind":"currency","decimals":6,"bridgeable":true},
  {"id":"xau","symbol":"g gold","displayName":"Gold","name":"Tokenized gold","kind":"gold","decimals":6,"bridgeable":false},
  {"id":"aapl","symbol":"AAPL","name":"Apple Inc. stock","kind":"stock","decimals":6,"bridgeable":false},
  {"id":"nvda","symbol":"NVDA","name":"Nvidia stock","kind":"stock","decimals":6,"bridgeable":false},
  {"id":"tsla","symbol":"TSLA","name":"Tesla stock","kind":"stock","decimals":6,"bridgeable":false}
]
```

Faucet caps (initial values, in smallest units, tune later): currencies `perCall` 10,000 whole units, `daily` 100,000; gold 100 and 1,000; stocks 100 and 1,000. The `near` and `evm` fields are filled in by the deploy scripts. **Agents must not invent addresses.** If a value is missing, the deploy script is incomplete.

### 3.3 Core contract types (NEAR, JSON shapes)

```ts
type Theme = "none" | "confetti" | "gift" | "balloons" | "hearts" | "gold";
type PackageStatus = "AWAITING_FUNDS" | "FUNDED" | "ACCEPTED" | "RECLAIMED";
type PartStatus =
  | "NOT_ACCEPTED" | "OPEN" | "WAITING_DATE" | "WAITING_APPROVAL"
  | "WAITING_DATE_AND_APPROVAL" | "PROCESSING" | "TAKEN";

interface PartInput {
  token: string;            // NEAR account id of an allowlisted NEP-141
  amount: string;           // u128 as decimal string, > 0
  unlock_ns?: string;       // u64 decimal string; must be > now at creation
  approvers?: string[];     // 1..5 distinct NEAR account ids; requires unlock_ns. May include the sender; must not include the recipient
  approval_threshold?: number; // 1..approvers.length; default 1 (a single approver)
}

interface CreatePackageArgs {
  parts: PartInput[];                 // 1..8
  accept_by_ns: string;               // deadline for accepting; now < accept_by_ns <= now + 90 days
  recipient?: string;                 // fixed receiver account (skip invite secret)
  invite_hash?: string;               // base64 sha256 of the invite secret; required if no recipient
  note?: string;                      // <= 140 UTF-8 chars, public on chain (this replaces the old `memo`)
  theme?: Theme;                      // opening-moment animation; default "none"
}

interface PartView {
  part_id: number;
  token: string; amount: string; funded: string;
  unlock_ns: string | null;
  approvers: string[]; threshold: number;   // empty list when the part has no approval rule
  approvals: string[]; approved: boolean;   // approvals = accounts that approved so far; approved = approvals.length >= threshold
  state: "LOCKED" | "PENDING" | "TAKEN";
  status: PartStatus;                 // computed at query time
  reason: string | null;              // human code, see 3.5 (e.g. TIME_NOT_REACHED)
  taken_ns: string | null;
}

interface PackageView {
  id: string; sender: string; recipient: string | null; owner: string | null;
  status: PackageStatus; note: string | null; theme: Theme;
  accept_by_ns: string; created_ns: string; accepted_ns: string | null;
  parts: PartView[];
}
```

### 3.4 Contract method list (full semantics in section 5)

Core (`core.ROOT`):

| Method | Caller | Deposit | Notes |
|---|---|---|---|
| `new(owner, allowed_tokens, limits)` | deployer | 0 | init |
| `create_package(args) -> id` | sender | 0 | storage paid by contract |
| `ft_on_transfer(sender_id, amount, msg) -> unused` | token contract | 0 | `msg = {"package_id":"1","part_id":0}` |
| `accept_package(package_id, invite_secret?)` | receiver | 0 | mints NFT |
| `approve_part(package_id, part_id)` | a named approver | 0 | one approval per approver |
| `claim(package_id, part_id)` | NFT owner | 0 | the UI word is "Take" |
| `reclaim_unaccepted(package_id)` | sender | 0 | |
| `on_claim_resolved(...)`, `on_reclaim_resolved(...)` | contract (private) | 0 | callbacks |
| `get_package`, `get_packages_by_sender`, `get_packages_by_owner`, `get_config`, `storage_report` | anyone | | views |
| NEP-171/177/181 views, `nft_transfer*` (always panics) | | | |
| `set_paused`, `set_allowed_tokens`, `set_limits`, `top_up` (payable), `migrate` | admin | | **no fund-moving method** |

Mock fungible token (`<asset>.ROOT`): NEP-141 + NEP-145 plus `ft_mint(account_id, amount)` (public, capped), `ft_mint_privileged`, `ft_burn_privileged`, `ft_mint_call` (minter only).

Bridge (`bridge.ROOT`): `bridge_in(...)` (relayer), `ft_on_transfer(...)` (outbound), views.

### 3.5 Error codes (contract)

All panics read `ANDUM_ERR:<CODE>`.

| Code | Meaning |
|---|---|
| `PAUSED` | Contract is paused |
| `NOT_ADMIN` | Caller is not the admin |
| `TOKEN_NOT_ALLOWED` | Token is not on the allowlist |
| `INVALID_PARTS` | Zero parts, more than 8, or malformed |
| `INVALID_AMOUNT` | Amount is zero or does not parse |
| `INVALID_RULE` | Approver given without unlock time |
| `UNLOCK_IN_PAST` | Unlock time is not in the future |
| `INVALID_EXPIRY` | Acceptance deadline is not in `(now, now+90d]` |
| `NOTE_TOO_LONG` | Note longer than 140 characters |
| `INVALID_THEME` | Theme is not in the list |
| `INVALID_APPROVERS` | More than 5, duplicates, threshold out of range, or the fixed recipient is an approver |
| `RECEIVER_IS_APPROVER` | The account accepting the package is one of its approvers |
| `LIMIT_EXCEEDED` | Per-sender package limit reached |
| `PACKAGE_NOT_FOUND`, `PART_NOT_FOUND` | Unknown id |
| `NOT_SENDER` | Caller is not the package sender |
| `NOT_APPROVER` | Caller is not a named approver of this part |
| `NOT_PASS_OWNER` | Caller does not own the package NFT |
| `WRONG_TOKEN` | `ft_on_transfer` called by a token other than the part's token |
| `WRONG_SENDER` | Funding came from someone other than the package sender |
| `BAD_MSG` | Funding message missing or malformed |
| `PACKAGE_NOT_ACTIVE` | Action needs an accepted package |
| `ALREADY_ACCEPTED` | Package already accepted |
| `INVITE_EXPIRED` | Past `accept_by_ns` |
| `INVITE_SECRET_INVALID` | Secret does not hash to `invite_hash` |
| `NOT_INVITED_ACCOUNT` | Package names a different receiver |
| `TIME_NOT_REACHED` | Unlock time has not passed |
| `APPROVAL_MISSING` | Approval not recorded |
| `ALREADY_TAKEN` | Part already taken |
| `TRANSFER_PENDING` | A transfer for this part is in flight |
| `NOT_RECLAIMABLE` | Package accepted, or deadline not reached |
| `ALREADY_RECLAIMED` | Package already reclaimed |
| `PASS_NOT_TRANSFERABLE` | NFT transfer attempted |
| `STORAGE_RESERVE_LOW` | Contract balance too low to store new state |

### 3.6 Events (NEP-297)

Format: `EVENT_JSON:{"standard":"andum","version":"1.0.0","event":"<name>","data":[{...}]}`

| Event | `data` fields |
|---|---|
| `package_created` | `package_id, sender, parts:[{part_id,token,amount,unlock_ns,approvers,threshold}], accept_by_ns, recipient, note, theme` |
| `part_funded` | `package_id, part_id, token, amount, funded_total` |
| `package_funded` | `package_id` |
| `deposit_refunded` | `package_id, part_id, token, amount` (excess returned) |
| `package_accepted` | `package_id, owner` |
| `part_approved` | `package_id, part_id, approver, approvals, threshold, threshold_met` (`threshold_met` is true on the approval that reaches the threshold) |
| `claim_started` | `package_id, part_id, attempt_id, owner` |
| `part_claimed` | `package_id, part_id, owner, token, amount` |
| `claim_failed` | `package_id, part_id, attempt_id` |
| `package_reclaimed` | `package_id, sender, returned:[{token,amount}]` |

NEP-171 `nft_mint` is also emitted on accept.

### 3.7 API surface (summary; full spec in section 7.4)

`POST /v1/auth/session`, `POST /v1/accounts/bootstrap`, `POST /v1/invites`, `POST /v1/invites/{id}/attach`, `PATCH /v1/invites/{id}/link`, `GET /v1/links/check`, `GET /v1/links/{slug}`, `GET /v1/invites/{id}/public`, `POST /v1/invites/{id}/verify/start`, `POST /v1/invites/{id}/verify/confirm`, `POST /v1/relay/submit`, `GET /v1/relay/{id}`, `GET /v1/packages`, `GET /v1/packages/{id}`, `GET /v1/packages/{id}/events`, `GET /v1/notifications/prefs`, `PUT /v1/notifications/prefs`, `POST /v1/faucet/near`, `POST /v1/faucet/evm`, `GET /v1/bridge/assets`, `POST /v1/bridge/out/quote`, `GET /v1/bridge/transfers`, `GET /v1/bridge/transfers/{id}`, `GET /v1/stream`, `GET /v1/time`, `GET /healthz`, `GET /readyz`.

Error body (all endpoints): `{"error":{"code":"RELAY_POLICY_DENIED","message":"...","details":{}}}`. API error codes are in section 7.4.

### 3.8 Invariants (must hold at all times; tested in `ANDUM-TEST.md`)

| ID | Invariant |
|---|---|
| I-1 | No admin or relayer method can move package funds. |
| I-2 | For every part: `taken_amount + refunded_amount <= funded <= amount`. |
| I-3 | A part is paid at most once, even under parallel calls and callback failures. |
| I-4 | Total tokens held for a package equals funded minus taken minus reclaimed. |
| I-5 | Terms (parts, amounts, unlock times, approvers, recipient) never change after creation. |
| I-6 | Exactly one NFT exists per accepted package, and its owner is the receiver. |
| I-7 | Only allowlisted tokens ever appear in a package. |
| I-8 | An EVM release or a NEAR `bridge_in` is executed at most once per source nonce. |
| I-9 | Backend never holds a key that can move package funds. |

---

## 4. Repository layout

```
andum/
  README.md                    # judge-facing, "do X, see Y" (section 12)
  docs/
    ANDUM-PLAN.md  ANDUM-TEST.md
    DECISIONS.md  VERIFY-LOG.md  RUNBOOK.md  interface-changes.md
  packages/shared/             # types, assets.json, error codes, event schemas, OpenAPI
  contracts/
    near/
      core/                    # Rust, near-sdk 5.x
      mock-ft/
      bridge/
      Cargo.toml (workspace)
    evm/                       # Foundry
      src/ MockERC20.sol AndumGateway.sol
      script/ DeployMocks.s.sol DeployGateway.s.sol
      test/
  backend/
    api/                       # Fastify
    workers/                   # relayer, reconciler, notifier, bridge, faucet
    db/                        # migrations
  apps/web/                    # Next.js app built from the prototypes
  scripts/                     # deploy-near.sh, deploy-evm.sh, seed.sh, smoke.sh
  deployments/                 # near.testnet.json, sepolia.json, base-sepolia.json (generated)
  .env.example
```

Tooling (pin versions, **[VERIFY]** current stable releases): Rust stable with `wasm32-unknown-unknown`, `near-sdk` 5.x, `near-contract-standards`, `near-workspaces` for tests, `cargo-near` for builds. Foundry with OpenZeppelin v5. Node 20 LTS, pnpm, TypeScript 5, Fastify, Postgres 16, Redis 7, Drizzle or Prisma, viem, `near-api-js`, Vitest, Playwright.

---

## 5. NEAR contracts (Rust)

### 5.1 `core` storage

```rust
pub struct Contract {
    owner: AccountId,                       // admin
    paused: bool,
    allowed_tokens: UnorderedSet<AccountId>,
    limits: Limits,                         // max_parts=8, max_open_per_sender=50, max_note=140, max_approvers=5, max_accept_window_days=90
    next_package_id: u64,
    packages: LookupMap<u64, Package>,
    by_sender: LookupMap<AccountId, UnorderedSet<u64>>,
    nft: NonFungibleToken,                  // near-contract-standards, with transfer disabled
    open_count: LookupMap<AccountId, u32>,  // sender -> not-yet-finished packages
}
pub struct Package {
    id: u64, sender: AccountId, recipient: Option<AccountId>, owner: Option<AccountId>,
    invite_hash: Option<[u8;32]>, accept_by_ns: u64, created_ns: u64, accepted_ns: Option<u64>,
    status: PackageStatus, note: Option<String>, theme: Theme, parts: Vec<Part>,
}
pub struct Part {
    token: AccountId, amount: u128, funded: u128,
    unlock_ns: Option<u64>, approvers: Vec<AccountId>, threshold: u8, approvals: Vec<AccountId>,   // approved = approvals.len() >= threshold
    state: PartState,        // Locked | Pending{attempt_id:u64} | Taken{taken_ns:u64}
    attempts: u64,           // monotonic attempt counter
}
```

### 5.2 `create_package`

Validation, in order, each failing with the code in 3.5: not paused (`PAUSED`); `1..=max_parts` parts (`INVALID_PARTS`); every token allowlisted (`TOKEN_NOT_ALLOWED`); every amount `> 0` (`INVALID_AMOUNT`); `approvers` only with `unlock_ns` (`INVALID_RULE`); 1 to 5 distinct approvers, threshold between 1 and the number of approvers, and the fixed recipient (if any) not among them (`INVALID_APPROVERS`); `theme` in the list (`INVALID_THEME`); `unlock_ns > now` (`UNLOCK_IN_PAST`); `now < accept_by_ns <= now + 90 days` (`INVALID_EXPIRY`); note length (`NOTE_TOO_LONG`); exactly one of `recipient` or `invite_hash` (`INVALID_PARTS` with log detail); sender open-package count below the limit (`LIMIT_EXCEEDED`); contract balance covers storage (`STORAGE_RESERVE_LOW`).

Effects: assign `id`, store `Package { status: AWAITING_FUNDS, .. }`, add to `by_sender`, increment `open_count`, emit `package_created`. Return the id as a string.

### 5.3 `ft_on_transfer(sender_id, amount, msg)` (funding)

Called by the token contract. `env::predecessor_account_id()` is the token.

1. Parse `msg` as `{"package_id":"<u64>","part_id":<u8>}`; otherwise `BAD_MSG`.
2. Package must exist and be `AWAITING_FUNDS`; otherwise `PACKAGE_NOT_ACTIVE`.
3. `predecessor == part.token`; otherwise `WRONG_TOKEN`.
4. `sender_id == package.sender`; otherwise `WRONG_SENDER`.
5. `remaining = part.amount - part.funded`. `accepted = min(amount, remaining)`. `part.funded += accepted`. Return `amount - accepted` as the unused amount (the token refunds it). If `unused > 0` emit `deposit_refunded`.
6. Emit `part_funded`. If every part is fully funded, set `FUNDED` and emit `package_funded`.

Panicking (instead of returning) is acceptable for errors 1 to 4: the token treats a failed receiver call as a full refund.

### 5.4 `accept_package(package_id, invite_secret?)`

Caller `R = predecessor`. Checks: status `FUNDED` (`PACKAGE_NOT_ACTIVE`; `ALREADY_ACCEPTED` if accepted); `now <= accept_by_ns` (`INVITE_EXPIRED`). If `recipient` is set, `R == recipient` (`NOT_INVITED_ACCOUNT`). Otherwise `sha256(invite_secret) == invite_hash` (`INVITE_SECRET_INVALID`).

Effects: `owner = R`, `accepted_ns = now`, status `ACCEPTED`, mint NFT with `token_id = package_id` to `R` (emit `nft_mint`), decrement sender's `open_count` is **not** done here (it happens when all parts are taken or on reclaim). For each distinct part token, send `storage_deposit(account_id = R, registration_only = true)` with the standard minimum deposit **paid from the contract balance** (fire and forget; claim retries registration, see 5.5). Emit `package_accepted`.

The invite secret becomes public in the transaction arguments. Mitigation: single use, short deadline, and the backend only releases it after email verification. A race on a public secret is accepted for the demo and must be listed in the README.

### 5.5 `claim(package_id, part_id)`

Caller `C = predecessor`.

1. `ACCEPTED` and `C == owner` (`NOT_PASS_OWNER`, `PACKAGE_NOT_ACTIVE`). Part exists.
2. Part state: `Taken` gives `ALREADY_TAKEN`; `Pending` gives `TRANSFER_PENDING`.
3. If `unlock_ns` is set and `now < unlock_ns` give `TIME_NOT_REACHED`. If the part has approvers and `approvals.len() < threshold` give `APPROVAL_MISSING`. When both fail, report `TIME_NOT_REACHED` first.
4. Effects: `attempts += 1`; state `Pending{attempt_id = attempts}`; emit `claim_started`.
5. Promise chain: `token.storage_deposit(C, registration_only=true)` (deposit from contract balance, small) then `token.ft_transfer(C, amount, memo)` (1 yoctoNEAR from contract balance) then `self.on_claim_resolved(package_id, part_id, attempt_id)`.

`on_claim_resolved` (private): look up the part. If the part's state is `Pending{attempt_id}` with the same id: on success set `Taken{now}`, emit `part_claimed`, and if every part is `Taken` decrement the sender's `open_count`; on failure set `Locked`, emit `claim_failed`. If the attempt id does not match, do nothing. The state change happens **only** in the callback, so a failed transfer can never leave a part marked taken.

Failure modes that must be tested: token transfer fails; recipient not registered; callback runs after another attempt; two `claim` calls in the same block (the second sees `Pending` and fails with `TRANSFER_PENDING`).

### 5.6 `approve_part`, `reclaim_unaccepted`

`approve_part(package_id, part_id)`: caller must be one of `part.approvers` (`NOT_APPROVER`); package status `FUNDED` or `ACCEPTED`; each approver counts once (a second call from the same approver is a no-op without error and no event); append the caller to `approvals` and emit `part_approved` with the running count and whether the threshold is now met. Allowed before the unlock date, and after the threshold is met (extra approvals are recorded but change nothing). `accept_package` additionally fails with `RECEIVER_IS_APPROVER` if the accepting account is an approver of any part, so the receiver can never approve their own package.

`reclaim_unaccepted(package_id)`: caller is the sender (`NOT_SENDER`); package is not `ACCEPTED` and not `RECLAIMED` (`NOT_RECLAIMABLE`, `ALREADY_RECLAIMED`); allowed if status is `AWAITING_FUNDS` (any time) or `FUNDED` and `now > accept_by_ns`. Set status `RECLAIMED` first (blocks re-entry), then for each part with `funded > 0` call `token.ft_transfer(sender, funded)` with a callback that, on failure, restores the part's `refundable` marker so the sender can retry via `reclaim_unaccepted` again (add field `reclaimed: u128` per part, status stays `RECLAIMED`, and the method is idempotent per part). Emit `package_reclaimed` with what was returned. Decrement `open_count`.

### 5.7 Views and computed status

`get_package(id) -> PackageView` computes each part's `status` and `reason` at query time:

| Condition (package `ACCEPTED`) | `status` | `reason` |
|---|---|---|
| Part `Taken` | `TAKEN` | null |
| Part `Pending` | `PROCESSING` | null |
| Date passed (or none) and approved (or none) | `OPEN` | null |
| Date not passed, approval missing | `WAITING_DATE_AND_APPROVAL` | `TIME_NOT_REACHED` |
| Date not passed, threshold met or no approvers | `WAITING_DATE` | `TIME_NOT_REACHED` |
| Date passed, threshold not met | `WAITING_APPROVAL` | `APPROVAL_MISSING` |

The `reason` is a code only. The web app builds the readable text from `approvals` and `threshold` (for example "1 of 2 approvals in").

If the package is not `ACCEPTED`, every untaken part is `NOT_ACCEPTED` with reason `PACKAGE_NOT_ACTIVE`. `owner` is the NFT owner. `get_packages_by_sender(account, from, limit)` and `get_packages_by_owner(account, from, limit)` paginate. `storage_report()` returns `{balance, locked_for_storage, available, packages, bytes_used}`.

### 5.8 NFT

Use `near-contract-standards::non_fungible_token` with enumeration and metadata. `nft_transfer` and `nft_transfer_call` always panic `ANDUM_ERR:PASS_NOT_TRANSFERABLE`. Metadata: `name = "Andum package #<id>"`, `symbol = "ANDUM"`, `description` holds the note when present, `media = <API_BASE>/v1/packages/<id>/nft.svg` (the image reflects the theme) (generated by the backend; the contract only stores the URL), `reference` null. The contract must work even if the backend is down.

### 5.9 Storage, gas, limits

- **Storage** is paid by the contract's balance. Roughly 1 byte costs `10^19` yoctoNEAR (so 1 KB is 0.01 NEAR). A package with 3 parts is about 700 bytes (0.007 NEAR) plus an NFT record. `create_package` and `accept_package` check `storage_report().available` and fail with `STORAGE_RESERVE_LOW` rather than panic mid-way.
- **Initial gas** (tune in tests): `create_package` 30 Tgas, `ft_on_transfer` 30 Tgas, `accept_package` 150 Tgas (up to 8 registrations), `claim` 120 Tgas, `reclaim_unaccepted` 150 Tgas, callbacks 20 Tgas. **[VERIFY]** with real runs.
- **Anti-spam**: `max_open_per_sender = 50`; relayer quotas (7.5); note and part limits.
- **Admin**: `owner` can call `set_paused`, `set_allowed_tokens`, `set_limits`, `top_up` (payable) and `migrate`. Contract upgrade uses the owner's access key. Document in README.

### 5.10 `mock-ft`

NEP-141 plus NEP-145 (storage management) using `near-contract-standards::fungible_token`. Constructor `new(owner_id, name, symbol, decimals=6, minters: Vec<AccountId>, caps)`. Methods:

| Method | Caller | Behaviour |
|---|---|---|
| `ft_mint(account_id, amount)` | anyone | Public faucet. `amount <= per_call_cap`. Per-account sliding 24 h total `<= daily_cap`. Auto-registers storage (paid by the token contract's balance). Errors: `FAUCET_CAP_PER_CALL`, `FAUCET_CAP_DAILY`. |
| `ft_mint_privileged(account_id, amount)` | minter | No caps. |
| `ft_burn_privileged(amount)` | minter | Burns from the caller's own balance. |
| `ft_mint_call(receiver_id, amount, sender_override, msg)` | minter | Mints to `receiver_id`, then calls `receiver_id.ft_on_transfer(sender_override, amount, msg)`. Whatever the receiver returns as unused is **burned** from the receiver, and the burned amount is reported to the caller (the bridge refunds it to `sender_override` by a plain mint). |
| `get_caps()`, `faucet_remaining(account_id)` | views | |

Deploy eleven instances from one wasm, one per asset in 3.2.

### 5.11 `bridge` (P2)

State: `relayer: AccountId`, `registry: map token_id -> {bridgeable, enabled}`, `processed_in: LookupSet<(String, u64)>`, `next_out_nonce: u64`, `outbound: LookupMap<u64, Outbound>`.

- `bridge_in(token_id, near_receiver, amount, src_chain, src_nonce, src_tx_hash, fund?: {package_id, part_id})` (relayer only; `BRIDGE_NOT_RELAYER`). Idempotent: if `(src_chain, src_nonce)` is processed, return without effect. Without `fund`: `token.ft_mint_privileged(near_receiver, amount)`. With `fund`: `token.ft_mint_call(core, amount, near_receiver, msg)` then a callback that, if the core returned unused tokens, mints that amount to `near_receiver`. Emit `bridge_in_done`.
- `ft_on_transfer(sender_id, amount, msg)` (outbound): token must be `bridgeable`; `msg = {"dest_chain":"sepolia"|"baseSepolia","dest_address":"0x.."}`; validate the address; call `token.ft_burn_privileged(amount)`; record `Outbound{nonce, token_id, from: sender_id, dest_chain, dest_address, amount, ts}`; emit `bridge_out`; return 0.
- Views: `get_outbound(nonce)`, `get_outbound_range(from, limit)`, `next_out_nonce()`.

Fees are zero in the mock.

### 5.12 Deployment script (`scripts/deploy-near.sh`)

Idempotent steps: create subaccounts from `ROOT`, deploy wasm, `new` calls, allowlist the eleven tokens, grant minter role to the bridge, fund `core` and `relayer`, write `deployments/near.testnet.json`, run `scripts/smoke.sh`. Never prints keys. **[HUMAN]** supplies `ROOT` credentials through the local NEAR keystore, not through files in the repo.

---

## 6. EVM contracts (Solidity, Foundry) (P2)

### 6.1 `MockERC20`

OpenZeppelin v5: `ERC20`, `ERC20Burnable`, `ERC20Permit`, `AccessControl`. Constructor `(name, symbol, decimals=6, faucetPerCall, faucetDaily, admin)`. Roles: `MINTER_ROLE` (granted to the gateway). Public `faucet(address to, uint256 amount)`: `amount <= faucetPerCall`; rolling 24 h per-`to` total `<= faucetDaily`; reverts `FaucetCapPerCall` or `FaucetCapDaily`. `mint(to, amount)` requires `MINTER_ROLE`.

### 6.2 `AndumGateway`

`Ownable2Step`, `Pausable`, `ReentrancyGuard`, `ERC2771Context` (trusted forwarder set in constructor).

```solidity
struct Asset { address token; bool enabled; uint256 maxPerTx; }
mapping(bytes32 => Asset) public assets;          // keccak256("usdc") etc.
mapping(address => bool) public relayers;
mapping(uint256 => bool) public processedNearNonce;

event DepositedForNear(uint256 indexed nonce, bytes32 indexed assetId, address indexed from,
                       uint256 amount, string nearAccount, uint64 packageId, uint8 partId, bool fund);
event Released(uint256 indexed nearNonce, bytes32 indexed assetId, address indexed to,
               uint256 amount, string nearTxHash);

function depositForNear(bytes32 assetId, uint256 amount, string calldata nearAccount,
                        uint64 packageId, uint8 partId, bool fund) external;
function depositForNearWithPermit(..., uint256 deadline, uint8 v, bytes32 r, bytes32 s) external;
function release(bytes32 assetId, address to, uint256 amount, uint256 nearNonce,
                 string calldata nearTxHash) external; // onlyRelayer
```

`depositForNear`: asset enabled, `0 < amount <= maxPerTx`, `nearAccount` non-empty and at most 64 bytes, `token.burnFrom(_msgSender(), amount)` (needs allowance; the permit variant sets it), `nonce = ++outNonce`, emit `DepositedForNear`. `release`: only `relayers`, not paused, `processedNearNonce[nearNonce]` must be false, set it, `token.mint(to, amount)`, emit `Released`. Admin: `setAsset`, `setRelayer`, `pause`, `unpause`.

### 6.3 Forwarder

Deploy OpenZeppelin `ERC2771Forwarder` per chain. The relayer EOA calls `forwarder.execute(request)` where `request` is the user's EIP-712 `ForwardRequest`. A user depositing gaslessly signs two EIP-712 messages: the permit and the forward request (whose `data` is `depositForNearWithPermit(...)`). **[VERIFY]** the exact OpenZeppelin v5 `ERC2771Forwarder` request type before writing the web signing code.

### 6.4 Scripts

`DeployMocks.s.sol` deploys the eleven tokens per chain and prints addresses. `DeployGateway.s.sol` deploys forwarder and gateway, registers assets, grants `MINTER_ROLE`, sets the bridge relayer. Both write `deployments/<network>.json`. Keys come from the environment (`EVM_DEPLOYER_PK`), never the repo. **[HUMAN]** funds the deployer and the relayer with test ETH on both chains.

---

## 7. Backend (TypeScript)

### 7.1 Services

One codebase, several processes. A single `docker compose up` runs all of them locally.

| Process | Responsibility | Reads | Writes |
|---|---|---|---|
| `api` | HTTP, auth, validation, SSE | DB | DB, queue |
| `relayer` | Dequeue relay jobs, apply policy, submit to NEAR, record outcome | DB, queue | DB, NEAR |
| `reconciler` | Refresh package cache from chain views, parse events | NEAR | DB |
| `notifier` | Find parts that have opened, email once | DB, NEAR (re-check) | DB, email |
| `bridge` | EVM and NEAR watchers, state machines (P2) | EVM, NEAR | DB, EVM, NEAR |
| `faucet` | Part of `api` (rate limit) with a signer for mints | DB | NEAR, EVM |

### 7.2 Database schema (PostgreSQL 16)

```sql
create table users (
  id uuid primary key default gen_random_uuid(),
  auth_provider text not null,            -- 'privy' | 'web3auth' | 'local'
  auth_subject text not null,
  email citext,
  near_account_id text not null unique,
  public_key text not null,               -- ed25519:...
  created_at timestamptz not null default now(),
  unique (auth_provider, auth_subject)
);
create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null, created_at timestamptz not null default now()
);
create table invites (
  id text primary key,                    -- random 22-char url-safe id
  sender_account text not null,
  recipient_email citext not null,
  secret_hash bytea not null,             -- sha256(secret); the secret itself is encrypted below
  secret_enc bytea not null,              -- AES-GCM with INVITE_ENC_KEY
  package_id bigint,                      -- set by /attach
  accept_by timestamptz,
  status text not null default 'DRAFT',   -- DRAFT | ATTACHED | VERIFIED | ACCEPTED | EXPIRED
  attach_tx text,
  slug citext unique,                     -- custom link name, 3..32 chars [a-z0-9-], no leading, trailing or double hyphen
  link_title text,                        -- <= 60 chars, plain text; null means the default title
  show_amount boolean not null default false, -- show amounts in the chat preview
  slug_changed_at timestamptz,
  created_at timestamptz not null default now()
);
create table link_redirects (
  old_slug citext primary key, invite_id text not null references invites(id), expires_at timestamptz not null
);
create table otp_codes (
  id uuid primary key default gen_random_uuid(),
  invite_id text not null references invites(id),
  code_hash bytea not null, attempts int not null default 0,
  expires_at timestamptz not null, used_at timestamptz,
  created_at timestamptz not null default now()
);
create table packages (                   -- cache of chain state
  id bigint primary key, sender text not null, owner text, status text not null,
  accept_by_ns numeric not null, view jsonb not null,
  updated_at timestamptz not null default now(), chain_block bigint
);
create index on packages (sender); create index on packages (owner);
create table parts (
  package_id bigint references packages(id) on delete cascade, part_id int,
  token text not null, amount numeric not null, unlock_ns numeric, approvers text[] not null default '{}', threshold int not null default 1,
  approvals text[] not null default '{}', approved boolean not null default false, state text not null, taken_ns numeric,
  primary key (package_id, part_id)
);
create index on parts (unlock_ns) where state = 'LOCKED';
create table chain_events (
  id bigserial primary key, chain text not null, tx_hash text not null,
  log_index int not null, event text not null, data jsonb not null,
  block_height bigint, created_at timestamptz not null default now(),
  unique (chain, tx_hash, log_index)
);
create table relay_jobs (
  id uuid primary key default gen_random_uuid(),
  client_request_id text not null, account_id text not null,
  receiver_id text not null, method text not null, payload_hash bytea not null,
  signed_delegate_b64 text not null, purpose text,
  status text not null default 'QUEUED',  -- QUEUED | SUBMITTED | SUCCEEDED | FAILED | REJECTED
  tx_hash text, error_code text, error_message text, outcome jsonb,
  attempts int not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (account_id, client_request_id), unique (payload_hash)
);
create table notifications (
  id uuid primary key default gen_random_uuid(),
  kind text not null,                     -- 'invite' | 'part_ready' | 'otp'
  dedupe_key text not null unique,        -- e.g. '17:1:part_ready'
  to_email citext not null, status text not null default 'PENDING', -- PENDING|SENT|SKIPPED|FAILED
  provider_id text, error text, created_at timestamptz not null default now(), sent_at timestamptz
);
create table notification_prefs (
  account_id text primary key, email_enabled boolean not null default true, email citext
);
create table faucet_claims (
  id bigserial primary key, chain text not null, asset_id text not null,
  recipient text not null, amount numeric not null, ip inet, tx_hash text,
  created_at timestamptz not null default now()
);
create index on faucet_claims (recipient, asset_id, created_at);
create table bridge_transfers (
  id uuid primary key default gen_random_uuid(),
  direction text not null,                -- 'EVM_TO_NEAR' | 'NEAR_TO_EVM'
  evm_chain text not null, asset_id text not null, amount numeric not null,
  evm_address text not null, near_account text not null,
  src_nonce numeric not null, src_tx text not null, dst_tx text,
  fund_package_id bigint, fund_part_id int,
  status text not null default 'DETECTED',-- DETECTED|CONFIRMED|SUBMITTED|DONE|FAILED
  error text, confirmations int not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (evm_chain, direction, src_nonce)
);
create table quota_usage (
  account_id text, bucket text, window_start timestamptz, used int not null default 0,
  primary key (account_id, bucket, window_start)
);
```

### 7.3 Authentication and wallets

The frontend talks to a `Signer` interface; the backend only ever sees a verified identity and signed delegate actions.

```ts
interface Signer {
  accountId(): Promise<string>;
  publicKey(): Promise<string>;                       // ed25519:...
  signDelegateAction(d: DelegateActionInput): Promise<SignedDelegateActionB64>;
}
```

Implementations, in order of preference (details in section 8.6):

1. `EmbeddedSigner` (Privy or Web3Auth) **if spike S-02 passes**: login by email or Google gives an ed25519 key; account id is the implicit account (hex of the public key).
2. `LocalKeySigner`: a key generated in the browser and stored encrypted in IndexedDB. Used for demo accounts and for tests. Labelled "demo account".
3. `WalletSelectorSigner` (`@near-wallet-selector`): MyNearWallet or Meteor **[VERIFY]** that the chosen wallet supports signing delegate actions.

`POST /v1/auth/session` takes the provider token, verifies it with the provider's server-side library (**[HUMAN]** supplies app id and secret), upserts the user, and returns a session cookie (httpOnly, SameSite=Lax) plus `{near_account_id}`. For `local` it accepts a signed challenge from the key instead.

### 7.4 API specification

Base path `/v1`. JSON only. Auth: session cookie unless marked public. Idempotency: `Idempotency-Key` header on all POSTs (except OTP); the same key with the same body returns the original response; the same key with a different body returns `409 IDEMPOTENCY_CONFLICT`.

| Method and path | Auth | Request | Response |
|---|---|---|---|
| `POST /auth/session` | public | `{provider, token}` or `{provider:"local", account_id, public_key, signature, nonce}` | `{user_id, near_account_id, email}` + cookie |
| `GET /time` | public | | `{server_ms, chain_ns}` |
| `POST /accounts/bootstrap` | user | `{}` | `{account_id, created:boolean, near_balance_yocto, topup_tx?}` Creates the implicit account by funding it with `TOPUP_NEAR` (default 0.02) if it does not exist or holds less than `TOPUP_MIN`. Capped per user and per day. |
| `POST /invites` | user | `{recipient_email}` | `{invite_id, invite_hash_b64}` Generates a 32-byte secret, stores it encrypted, returns only the hash. |
| `POST /invites/{id}/attach` | user (sender) | `{package_id, tx_hash}` | `{status:"ATTACHED"}` Verifies on chain: `get_package(package_id).sender == caller` and `invite_hash` matches. Sends the invite email (idempotent). |
| `GET /links/check` | user | `?slug=rina-audit-bonus` | `{available:boolean, reason?:"SLUG_TAKEN"|"SLUG_INVALID"|"SLUG_RESERVED", suggestion?:string}` Rate limited (30 per minute per user). Never confirms who owns a taken slug. |
| `PATCH /invites/{id}/link` | user (sender) | `{slug?, title?, show_amount?}` | `{slug, url, title, show_amount, preview:{title, description, image_url}}` Allowed while the invite is not `ACCEPTED` (`LINK_LOCKED` otherwise). Changing the slug keeps the old one as a redirect for 24 hours. At most 10 changes per hour. Title is stored as plain text and escaped on output. |
| `GET /links/{slug}` | public | | `{invite_id}` or a redirect hint. Used by the web app route `/p/{slug}`. Rate limited per IP. |
| `GET /p/{slug}` | public (web) | | Server-rendered page with `og:title`, `og:description`, `og:image` and `twitter:card` for chat previews. Same content as the invite public view. The preview never contains the recipient's email. Amounts appear only if `show_amount` is true. |
| `GET /p/{slug}/og.png` | public | | 1200x630 image: theme artwork, title, "from <sender>". No amounts unless `show_amount`. Cached for 5 minutes. |
| `GET /invites/{id}/public` | public | | `{sender_display, package:{id, status, theme, has_note, parts:[{token,amount,unlock_ns,approver_count,threshold}], total_by_token}, accept_by_ms, email_hint:"r***@example.com"}` Reads chain state. No secret. The note is public on chain, but the app shows it only after the receiver accepts, so the opening stays a surprise. |
| `POST /invites/{id}/verify/start` | public | `{}` | `{sent:true, resend_after_s}` Emails a 6-digit code (valid 10 min, 5 attempts, 60 s resend limit). |
| `POST /invites/{id}/verify/confirm` | public | `{code}` | `{package_id, invite_secret}` Single use per verification; the secret is returned once and the invite moves to `VERIFIED`. |
| `POST /relay/submit` | user | `{signed_delegate_b64, purpose, client_request_id}` | `202 {relay_id, status:"QUEUED"}` or `4xx` policy error |
| `GET /relay/{id}` | user (owner) | | `{status, tx_hash?, error_code?, error_message?, outcome?}` |
| `GET /packages` | user | `?role=sender\|owner\|approver&cursor=` | `{items:[PackageView], next}` |
| `GET /packages/{id}` | user (party) | | `PackageView` (fresh read if cache older than 10 s) |
| `GET /packages/{id}/events` | user (party) | | `[{event, data, tx_hash, ts}]` |
| `GET /packages/{id}/nft.svg` | public | | SVG image generated from the cached view |
| `GET /notifications/prefs`, `PUT /notifications/prefs` | user | `{email_enabled, email?}` | prefs |
| `POST /faucet/near` | user | `{asset_id, amount?}` | `{tx_hash, minted}` Backend submits `ft_mint` for the caller. Same caps as the contract plus per-IP limits. |
| `POST /faucet/evm` | user | `{chain, asset_id, address, amount?}` | `{tx_hash}` (P2) |
| `GET /bridge/assets` | public | | assets with `bridgeable:true` and EVM addresses |
| `POST /bridge/out/quote` | user | `{asset_id, amount, dest_chain, dest_address}` | `{fee:"0", eta_s, ft_transfer_call:{receiver_id, amount, msg}}` The web app builds the delegate action from this. |
| `GET /bridge/transfers`, `GET /bridge/transfers/{id}` | user | | transfers with status |
| `GET /stream` | user | | SSE: `package.updated`, `relay.updated`, `bridge.updated` |
| `GET /healthz`, `GET /readyz` | public | | liveness; readiness checks DB, Redis, NEAR RPC |

API error codes: `UNAUTHENTICATED`, `FORBIDDEN`, `VALIDATION_FAILED`, `NOT_FOUND`, `RATE_LIMITED`, `IDEMPOTENCY_CONFLICT`, `RELAY_POLICY_DENIED` (details name the rule), `RELAY_EXPIRED`, `RELAY_DUPLICATE`, `RELAY_CHAIN_FAILURE` (carries the `ANDUM_ERR` code), `INVITE_NOT_FOUND`, `SLUG_TAKEN`, `SLUG_INVALID`, `SLUG_RESERVED`, `LINK_LOCKED`, `INVITE_EXPIRED`, `INVITE_NOT_ATTACHED`, `OTP_INVALID`, `OTP_EXPIRED`, `OTP_LOCKED`, `FAUCET_CAP`, `BOOTSTRAP_LIMIT`, `UPSTREAM_UNAVAILABLE`.

#### 7.4.1 Link rules

| Rule | Detail |
|---|---|
| Format | 3 to 32 characters, `[a-z0-9-]`, no leading, trailing or double hyphen. The web app lowercases and strips other characters as the user types. |
| Reserved | `new, admin, api, help, app, p, assets, approve, packages, login` and anything starting with `andum`. Extend the list in `packages/shared`. |
| Uniqueness | Global. A taken slug returns `SLUG_TAKEN` with a suggestion (`<slug>-2`). |
| Default | `<recipient-first-name>-package` or `-payment`, with a short suffix if taken. A "Suggest" button generates `<name>-<word>`. |
| Changes | Until the package is accepted. The old slug redirects for 24 hours (`link_redirects`), then is released after 30 days. |
| Preview privacy | Amounts hidden by default. The preview never shows the recipient's email. The note is never in the preview. |
| Safety | A slug is only an address. Knowing it shows the same public information the chain already shows. Accepting still needs the email code (A-INV). Lookups are rate limited so slugs cannot be enumerated cheaply. Titles are plain text, escaped everywhere, and run through the same abuse filter as the note. |
| Not on chain | Nothing about the link is stored in the contract. |

### 7.5 Relayer policy engine

A pure function `decide(job, state) -> allow | deny(rule)`, unit-tested exhaustively. Rules, all must pass:

| Rule | Check |
|---|---|
| R1 identity | The delegate `sender_id` equals the session's `near_account_id`. |
| R2 signature | The signature verifies against a public key the account has, or against the user's registered `public_key`. |
| R3 expiry | `max_block_height` is in `(current, current + 200]`. |
| R4 nonce | The nonce is greater than the account key's current nonce. |
| R5 receiver and method | `(receiver_id, method)` is on the allowlist (below). Exactly one `FunctionCall` action per delegate action. |
| R6 deposit | Deposit is `0`, except `ft_transfer_call` which must carry exactly `1` yoctoNEAR. |
| R7 gas | Attached gas does not exceed the per-method cap (below). |
| R8 arguments | For `ft_transfer_call`, `args.receiver_id` is `core.ROOT` or `bridge.ROOT` and `msg` parses. For `ft_mint`, `args.account_id` equals the sender. For `claim`, `approve_part` and the like, `package_id` is a decimal string. |
| R9 quota | Per account: 30 submissions per minute, 600 per day; `ft_mint` 3 per minute; all subject to the global daily budget (`RELAYER_DAILY_BUDGET_NEAR`). |
| R10 duplicate | `payload_hash` has not been seen. |
| R11 pause | Relayer not paused (kill switch in DB and env). |

Allowlist:

| Receiver | Methods | Max gas |
|---|---|---|
| `core.ROOT` | `create_package` 30 Tgas; `accept_package` 150; `approve_part` 30; `claim` 120; `reclaim_unaccepted` 150 | |
| any mock token | `ft_mint` 30; `ft_transfer_call` 80 | |

The relayer wraps the signed delegate action in a transaction signed by `relayer.ROOT`, submits it, waits for the final outcome, parses `EVENT_JSON` logs into `chain_events`, and updates the job. It retries only on transport errors and on `InvalidNonce` of the relayer's own key; it never retries a failed contract call. It keeps an in-process nonce manager for the relayer key and serialises submissions per relayer key (use several relayer keys later if throughput needs it).

### 7.6 Reconciler

- **On relay success**: parse logs, upsert `chain_events`, then fetch `get_package(id)` for each package id mentioned and upsert `packages` and `parts`.
- **Periodic (every 15 s)**: refresh packages with any part not `TAKEN` and not `RECLAIMED`, touched in the last 7 days, in batches of 20.
- **On API read**: if the cached row is older than 10 s, fetch fresh.
- Source of truth is always the contract view. The cache must never be used to decide anything that moves money.

### 7.7 Notifier

Every 30 s: select `LOCKED` parts of accepted packages whose `unlock_ns <= now` and (no approvers or approvals reached the threshold) and with no `part_ready` notification. For each, **re-check** `get_package` on chain; if the part is `OPEN`, insert a `notifications` row with `dedupe_key = "<package>:<part>:part_ready"` (unique), send the email, mark `SENT`. If the recipient has disabled emails, mark `SKIPPED`. Failed sends retry with backoff up to 5 times. Also sends invite and OTP emails. Email provider is abstracted (`Mailer` interface): Resend or SMTP in staging, Mailpit locally. **[HUMAN]** supplies the provider key and a sender address. Each named approver also gets one `approval_request` email when the package is accepted (dedupe key `<package>:<part>:<approver>:approval_request`), and a reminder only when the sender asks for it.

### 7.8 Bridge worker (P2)

A `BridgeProvider` interface with a `MockBridgeProvider` (this section) and an unimplemented `IntentsBridgeProvider` stub (documented as the production path, because NEAR Intents has no testnet).

State machine per transfer: `DETECTED` then `CONFIRMED` (after N confirmations) then `SUBMITTED` (destination tx sent) then `DONE`, or `FAILED` (with error, retriable manually).

- **EVM to NEAR**: watch `DepositedForNear` on each chain with viem `getLogs` polling every 6 s. Confirmations: 2 on Sepolia, 5 on Base Sepolia **[VERIFY]**. Insert `bridge_transfers` unique on `(evm_chain, direction, src_nonce)`. When confirmed, call `bridge.bridge_in(...)` from `bridgeworker.ROOT`. `fund` is set when `packageId` and `partId` are non-zero in the event (the sender's NEAR account must equal `nearAccount`). Mark `DONE` with the NEAR tx hash.
- **NEAR to EVM**: read `bridge.get_outbound_range` since the last processed nonce every 5 s (plus the logs of relayer-submitted transactions). For each outbound transfer, call `gateway.release(assetId, to, amount, nonce, nearTxHash)` from the EVM relayer. Mark `DONE`.
- Reorg handling: only act after the confirmation depth. If a detected log disappears before confirmation, mark the transfer `FAILED` with `REORGED` and do nothing on the destination.
- Idempotency: both destinations are protected by on-chain replay guards (invariant I-8). The worker may be restarted at any time.

### 7.9 Configuration (`.env.example`)

```
NODE_ENV=development
PORT=8080
PUBLIC_API_BASE=http://localhost:8080
DATABASE_URL=postgres://andum:andum@localhost:5432/andum
REDIS_URL=redis://localhost:6379
SESSION_SECRET=change-me
INVITE_ENC_KEY=base64-32-bytes

NEAR_NETWORK=testnet
NEAR_RPC_URLS=https://test.rpc.fastnear.com,https://rpc.testnet.near.org
NEAR_ROOT=andum-hack.testnet
NEAR_CORE=core.andum-hack.testnet
NEAR_BRIDGE=bridge.andum-hack.testnet
RELAYER_ACCOUNT=relayer.andum-hack.testnet
RELAYER_PRIVATE_KEY=ed25519:...            # secret, never committed
RELAYER_DAILY_BUDGET_NEAR=5
TOPUP_NEAR=0.02
TOPUP_MIN_NEAR=0.005
BRIDGE_WORKER_ACCOUNT=bridgeworker.andum-hack.testnet
BRIDGE_WORKER_PRIVATE_KEY=ed25519:...

AUTH_PROVIDER=local                         # privy | web3auth | local
PRIVY_APP_ID=
PRIVY_APP_SECRET=
WEB3AUTH_CLIENT_ID=
EMAIL_PROVIDER=mailpit                      # resend | smtp | mailpit
RESEND_API_KEY=
EMAIL_FROM=Andum <no-reply@example.com>

EVM_RELAYER_PK=0x...
EVM_SEPOLIA_RPC=
EVM_BASE_SEPOLIA_RPC=
EVM_DEPLOYER_PK=0x...
```

### 7.10 Security requirements

Input validation with schemas on every endpoint. Rate limits per IP and per account. CORS limited to the web origin. No secret in logs. Invite secrets stored encrypted, never logged. OTP codes stored hashed. SQL via parameterised queries only. Dependency pinning and `npm audit` in CI. The relayer key holds only the NEAR needed for gas (invariant I-9). Kill switches for relayer, faucet and bridge in the database.

### 7.11 Observability

Structured JSON logs with a request id. Metrics endpoint with: relay jobs by status, policy denials by rule, relayer balance, reconciler lag, notifier queue depth, bridge transfers by status. An admin page or CLI that prints these is enough.

---

## 8. Frontend integration (`apps/web`)

### 8.1 Starting point

`andum-landing.html` and `andum-app-prototype.html` are design references with mocked state. Re-implement their screens in Next.js with the real API and contract. Keep the visual design, copy and the status words exactly: **Open, Waiting for date, Waiting for approval, Waiting for date and approval, Processing, Taken**. UI verbs: send, open, **Take** (not claim).

### 8.2 Screen to call map

| Screen (prototype) | Calls |
|---|---|
| Sender dashboard | `GET /packages?role=sender`; balances via NEAR RPC `ft_balance_of` |
| Assets (mint) | `POST /faucet/near` |
| Template, Build | local state; amounts converted with the asset registry |
| Review | local; shows "Network fee: Covered" |
| Fund | `POST /invites`; sign and relay `create_package` (with `invite_hash`); sign and relay one `ft_transfer_call` per token; `POST /invites/{id}/attach` |
| Share | `GET /packages/{id}`; link editor: `GET /links/check` while typing (debounced 350 ms), `PATCH /invites/{id}/link` when valid; live chat-preview card rendered locally from the same fields; link `PUBLIC_WEB_BASE/p/{slug}` |
| Track | `GET /packages/{id}`, SSE |
| Receiver link landing | `GET /links/{slug}`, then `GET /invites/{id}/public`; headline is the custom title when set |
| Receiver sign-in / accept | login, `POST /accounts/bootstrap`, `POST /invites/{id}/verify/start` and `confirm`, then sign and relay `accept_package(package_id, invite_secret)` |
| Receiver package | `GET /packages?role=owner`, SSE |
| Take | sign and relay `claim(package_id, part_id)`; show the `ANDUM_ERR` code mapped to the readable reason |
| Send to another wallet | `POST /bridge/out/quote`, sign and relay `ft_transfer_call(bridge)`, poll `GET /bridge/transfers/{id}` |
| Approver | `GET /packages?role=approver`; sign and relay `approve_part`; show "X of N needed" and which approvers have approved |
| Opening moment | Sender builds: theme picker, note, preview (local only). Receiver: gift or theme screen after `accept_package` succeeds, small burst after each take. Respect reduced motion. |
| Inbox | `GET /notifications` (optional) |

### 8.3 Reason code to copy map

`TIME_NOT_REACHED` maps to "Not yet: this part opens on <date>." `APPROVAL_MISSING` maps to "<approver> still has to approve this part." for one approver and "<n> more approvals needed." for a group. `PACKAGE_NOT_ACTIVE` maps to "Accept the package first." `TRANSFER_PENDING` maps to "Already on its way." `ALREADY_TAKEN` maps to "Already in your account." `NOT_PASS_OWNER` maps to "This package belongs to another account."

### 8.4 State and errors

Never infer eligibility in the browser for anything that matters. Display `status` and `reason` from `get_package`. The browser may preview ("opens in 2 days") but the button state comes from the chain view.

---

## 9. Workstreams for parallel agents

### 9.1 Overview

| WS | Name | Owns | Depends on |
|---|---|---|---|
| WS-0 | Interface Freeze | `packages/shared`, OpenAPI, deployments schema | none (first) |
| WS-A | NEAR core | `contracts/near/core` | WS-0 |
| WS-B | NEAR mock-ft and bridge | `contracts/near/mock-ft`, `bridge` | WS-0 |
| WS-C | Backend | `backend/*`, `db` | WS-0; chain access from WS-A and WS-B deployed on testnet |
| WS-D | EVM and bridge worker | `contracts/evm`, `backend/workers/bridge` | WS-0, WS-B |
| WS-E | Frontend | `apps/web` | WS-0; API from WS-C |
| WS-F | QA and UAT | test harness, E2E, UAT runs | all |

```mermaid
flowchart LR
  WS0 --> WSA & WSB & WSC & WSD & WSE
  WSB --> WSA
  WSA --> WSC
  WSB --> WSD
  WSC --> WSE
  WSA & WSB & WSC & WSD & WSE --> WSF
```

Contracts must be deployed to testnet early (even incomplete) so that WS-C and WS-E can integrate. A **walking skeleton** (section 9.4, Day 1) provides that.

### 9.2 Per-workstream definition of done

| WS | Deliverables | Done when |
|---|---|---|
| WS-0 | `packages/shared` published as a workspace package: TypeScript types, JSON schemas, `assets.json`, error code enums, event schemas, OpenAPI 3.1 file, Rust constants crate for error codes | Human approves (gate H-1). Lint and type checks pass. |
| WS-A | Core contract, sandbox tests for every `C-*` test ID, deploy script, `README` | All tests in `ANDUM-TEST.md` section 4 pass; testnet deployment works; invariants I-1 to I-7 hold under the property tests |
| WS-B | `mock-ft` (11 instances) and `bridge`, tests, deploy script | Section 5 of `ANDUM-TEST.md` passes; faucet works on testnet |
| WS-C | `api`, `relayer`, `reconciler`, `notifier`, DB migrations, docker compose, OpenAPI conformance | Sections 7 to 9 of `ANDUM-TEST.md` pass; `scripts/smoke.sh` passes against testnet |
| WS-D | Solidity contracts, deploy scripts, bridge worker | Section 6 of `ANDUM-TEST.md` passes; deployments on both chains; transfer both directions on testnet |
| WS-E | Web app implementing section 8 | UAT scripts U-* pass on desktop and phone width |
| WS-F | Playwright E2E, API contract tests, UAT scripts, test report | E2E-01 to E2E-08 pass on testnet; UAT signed off by the human |

### 9.3 Working agreement

- One branch per workstream: `ws-0-freeze`, `ws-a-core`, `ws-b-tokens`, `ws-c-backend`, `ws-d-evm`, `ws-e-web`, `ws-f-qa`. Small pull requests into `main` after review by another agent or the human. No force-pushes to `main`.
- Conventional commits. Every PR lists the test IDs it covers and the requirement IDs it satisfies.
- Interface changes: add an entry to `docs/interface-changes.md` (what, why, who is affected) and tag the human. Do not merge until approved. Until approved, keep working against the frozen version.
- Each agent writes a `HANDOFF.md` section at the end of its work: what exists, how to run it, what is known broken, open questions.
- Record decisions in `docs/DECISIONS.md`, facts verified in `docs/VERIFY-LOG.md`.
- When blocked on a **[HUMAN]** item, stop that task, post the exact request (what, why, where to put it), and continue with other tasks.

### 9.4 Schedule (UTC)

Today is 11 Nov. The deadline is 14 Nov 23:59. The plan keeps a buffer.

| Day | Goal | Output |
|---|---|---|
| **Day 1 (11 Nov)** | Freeze and walking skeleton | WS-0 approved (H-1). `core` with create, fund, accept, claim (no tests yet beyond happy path) and `mock-ft` deployed to testnet. Backend: relayer submitting one delegate action end to end. Spikes S-01, S-02, S-03 done. |
| **Day 2 (12 Nov)** | P0 complete | Core contract complete with tests. API complete (auth, bootstrap, invites, relay, packages). Web app: sender and receiver flows on real backend. Faucet. |
| **Day 3 (13 Nov)** | P1 and P2 | Approver flow, notifier, SSE, NFT views. EVM contracts, bridge worker, both directions on testnet. E2E suite running. UAT round 1. |
| **Day 4 (14 Nov)** | Freeze and ship | 08:00 UTC code freeze for features. Bug fixing, UAT round 2, README, demo video. **[HUMAN]** repository public, X post, submission by 20:00 UTC (deadline 23:59). |

Cut lines: if P0 is not complete at end of Day 2 (23:00), drop all P2 and the notifier email (use an in-app notice). If the bridge is not working by Day 3 18:00, drop it and keep the EVM faucet and gateway as a documented preview.

### 9.5 Human gates

| Gate | When | Human does | Agent waits for |
|---|---|---|---|
| H-1 | End of WS-0 | Review and approve the Interface Freeze | Approval before merging contracts or API code |
| H-2 | Day 1 | Create `ROOT` NEAR testnet account and fund it (at least 100 NEAR across faucets), create `relayer`, `admin`, `bridgeworker` keys, supply RPC URLs; create Privy or Web3Auth app (or choose `local`), email provider key; fund the EVM deployer and relayer with test ETH on both Sepolia networks | Credentials in the local keystore or secret manager, never in chat or the repo |
| H-3 | After first testnet deploy | Inspect the deployed contracts in the explorer, confirm allowlist and balances | Go for integration |
| H-4 | Day 3 evening | Run UAT script and sign the result sheet | Release candidate |
| H-5 | Day 4 | Make the repository public, write and publish the X demo post (tag @NEARProtocol and #NEARHackathon), submit the form with the repository and post links. **Agents never submit.** | Nothing; this is the end |

### 9.6 Spikes (time-boxed, do first)

| ID | Question | Time box | If it fails |
|---|---|---|---|
| S-01 | Can a delegate action (NEP-366) call `ft_transfer_call` with 1 yoctoNEAR deposit on testnet, paid for by `relayer.ROOT`, from an account holding at least 1 yoctoNEAR? Does the deposit come from the user? | 1.5 h | Fund users with a larger top-up and relax R6 to allow a deposit up to 0.001 NEAR. If delegate actions fail entirely, the relayer signs on behalf of demo accounts (**not acceptable for production, label as demo**). |
| S-02 | Can Privy or Web3Auth give an ed25519 key or a signature over a delegate action hash for NEAR, from email login? | 2 h | `LocalKeySigner` for demo accounts and `WalletSelectorSigner` for real wallets. The product copy "no seed phrase" then applies only to demo accounts; tell the human. |
| S-03 | Gas and storage for `accept_package` with 8 parts and `claim`, and storage cost per package | 1 h | Reduce `max_parts` |
| S-04 | Are `https://test.rpc.fastnear.com` and the default RPC reliable and fast enough for polling every 15 s? | 30 min | Use fewer polls, add a second provider |
| S-05 | OpenZeppelin v5 `ERC2771Forwarder` request shape and viem signing | 1 h | Relayer calls the gateway directly with a signed typed message instead |
| S-06 | Faucet funds: how much test NEAR can be obtained per day for `ROOT` and `core` | 30 min | Lower `max_open_per_sender`, shrink limits |

### 9.7 Agent prompt templates

Give each agent the plan, the test document, and one of these.

**WS-0 agent**: "You own `packages/shared`. Implement section 3 of `ANDUM-PLAN.md` exactly as code: TypeScript types, JSON schemas, `assets.json`, error-code enums (TS and Rust constants), event schemas, and an OpenAPI 3.1 file for the API in 7.4. Add a script that checks consistency between the OpenAPI file and the types. Do not add features. Open a pull request and ask the human to approve (gate H-1)."

**WS-A agent**: "You own `contracts/near/core`. Implement section 5.1 to 5.9 of `ANDUM-PLAN.md` with `near-sdk` 5.x. Write sandbox tests with `near-workspaces` covering every test ID with prefix `C-` in `ANDUM-TEST.md`. Mark facts you could not confirm with [VERIFY] in `docs/VERIFY-LOG.md`. Provide `scripts/deploy-near.sh` steps for the core contract. Do not change the interface in section 3."

**WS-B agent**: "You own `contracts/near/mock-ft` and `contracts/near/bridge`. Implement 5.10 and 5.11. Tests are the `F-` and `B-` IDs. Deploy eleven token instances."

**WS-C agent**: "You own the backend. Implement section 7 with Fastify, Postgres and Redis. Start with the walking skeleton: login with `AUTH_PROVIDER=local`, bootstrap, relay one delegate action, return the result. Then complete the API. The policy engine must be a pure function with exhaustive tests (`A-RELAY-*`). Never log secrets."

**WS-D agent**: "You own `contracts/evm` and the bridge worker. Implement section 6 and 7.8. Foundry tests for `E-*`, worker tests for `A-BRIDGE-*`. Verify the forwarder request shape first (spike S-05)."

**WS-E agent**: "You own `apps/web`. Rebuild the screens of `andum-app-prototype.html` against the real API, following section 8. Keep the visual design and copy. Implement the `Signer` abstraction; start with `LocalKeySigner` and add the others after spike S-02. UAT scripts are `U-*`."

**WS-F agent**: "You own quality. Build the test harness described in `ANDUM-TEST.md` (fixtures, test accounts, Playwright E2E, API contract tests against the OpenAPI file, a smoke script). Execute the suites, file defects with the template in the test document, and prepare the UAT sheet for the human."

---

## 10. Environments and deployment

| Environment | Purpose | How |
|---|---|---|
| Local | Development | `docker compose up` (Postgres, Redis, Mailpit, API, workers). NEAR sandbox for contract tests. Public testnets for integration. |
| Testnet-staging | UAT and demo | Backend on one small VM or PaaS **[HUMAN]** picks, web on a static host. Contracts on NEAR testnet and both Sepolia networks. |

Deployment steps are scripted (`scripts/deploy-near.sh`, `scripts/deploy-evm.sh`, `scripts/seed.sh`, `scripts/smoke.sh`). `RUNBOOK.md` covers: restarting workers, rotating the relayer key, refilling the relayer and `core` balances, pausing the contract and relayer, resetting the demo data, and what to check if emails do not arrive.

---

## 11. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Delegate actions behave differently than assumed (S-01) | Gasless promise breaks | Spike first; fallback in 9.6 |
| Embedded wallets cannot sign for NEAR (S-02) | "Email login" promise breaks | Local and wallet-selector fallbacks; be honest in the demo |
| Faucet limits starve `core` storage (S-06) | Cannot create packages | Lower limits; conserve; monitor `storage_report` |
| Public RPC rate limits | Slow or failing reads | Cache, backoff, second provider |
| Time pressure | Missing P0 | Cut lines in 9.4 |
| Invite secret visible in the accept transaction | Front-running | Single use, short deadline, documented; optional later fix: commit-reveal |
| Callback failure leaves a part pending | Part stuck | State changes only in callback; attempt ids; test C-CLAIM-30..35; admin runbook for stuck parts (view and alert, no fund-moving method) |
| Mock bridge trusted | Misleading claims | Label as demo everywhere; README states the production path (NEAR Intents) |
| Hackathon rule: code before 1 Nov is baseline | Disqualification risk | Disclose the prototypes (HTML) as design material in README; all contract and backend code is new |

---

## 12. Submission checklist (human performs; agents prepare)

Rules from `HACKATHON.md` (re-read the live file before submitting, it may change): repository public before **14 Nov 23:59 UTC**; demo post on X says the project was built at NEAR HACKATHON, tags @NEARProtocol and #NEARHackathon, with video or screenshots; the final submission is a single POST or the web form and cannot be edited afterwards (changes go through the request-changes page); one submission per repository; keep demo hosting up until 18 Nov (ideally 25 Nov); add a LICENSE.

Agents prepare:

- `README.md` for machine and human readers: what Andum is, how to try it in "do X, see Y" steps (the 90-second script), architecture, contract addresses and explorer links, what is mock, trust points, how to run locally, how to run tests, disclosure of pre-existing material and libraries used.
- A draft of the "what we built" text (20 to 2000 characters) and the demo post text. The human edits and sends them.
- The tracks to select: **NFTs That Do Something** (primary), **Real-World Money**, optionally **Open Innovation**.

---

## 13. Appendix A: sequences

### A.1 Create, fund, invite

```mermaid
sequenceDiagram
  participant S as Sender (web)
  participant API
  participant REL as Relayer
  participant CORE as core
  participant FT as token
  S->>API: POST /invites {email}
  API-->>S: invite_id, invite_hash
  S->>S: sign delegate(create_package, invite_hash)
  S->>API: POST /relay/submit
  API->>REL: job
  REL->>CORE: create_package (relayer pays gas)
  CORE-->>REL: package_id, events
  loop each token
    S->>S: sign delegate(token.ft_transfer_call(core, amount, msg))
    S->>API: POST /relay/submit
    REL->>FT: ft_transfer_call (1 yocto from sender)
    FT->>CORE: ft_on_transfer
    CORE-->>FT: unused=0
  end
  S->>API: POST /invites/{id}/attach
  API->>API: verify on chain, send invite email
```

### A.2 Accept

```mermaid
sequenceDiagram
  participant R as Receiver (web)
  participant API
  participant REL as Relayer
  participant CORE as core
  R->>API: GET /invites/{id}/public (funds visible)
  R->>R: login (embedded or local key)
  R->>API: POST /accounts/bootstrap
  R->>API: POST /invites/{id}/verify/start
  API-->>R: email with code
  R->>API: POST /invites/{id}/verify/confirm {code}
  API-->>R: package_id, invite_secret
  R->>R: sign delegate(accept_package(package_id, secret))
  R->>API: POST /relay/submit
  REL->>CORE: accept_package
  CORE-->>CORE: mint NFT, register token storage
```

### A.3 Approve and take

```mermaid
sequenceDiagram
  participant AP as Approver
  participant R as Receiver
  participant REL as Relayer
  participant CORE as core
  participant FT as token
  R->>REL: claim(part 1) (too early)
  REL->>CORE: claim
  CORE-->>REL: panic ANDUM_ERR:TIME_NOT_REACHED
  AP->>REL: approve_part
  REL->>CORE: approve_part
  Note over R: email "part is ready" (notifier)
  R->>REL: claim(part 1)
  REL->>CORE: claim
  CORE->>FT: storage_deposit + ft_transfer
  FT-->>CORE: ok
  CORE-->>CORE: on_claim_resolved: TAKEN
```

### A.4 Mock bridge

```mermaid
sequenceDiagram
  participant U as User (EVM wallet)
  participant GW as AndumGateway
  participant BW as Bridge worker
  participant BR as NEAR bridge
  participant FT as NEAR token
  U->>GW: depositForNear (burn mock token)
  GW-->>BW: DepositedForNear event
  BW->>BW: wait confirmations
  BW->>BR: bridge_in(nonce, receiver, amount)
  BR->>FT: ft_mint_privileged or ft_mint_call
  Note over U,FT: Reverse: user ft_transfer_call(bridge) burns on NEAR, worker calls gateway.release to mint on EVM
```

## 14. Appendix B: references

NEP-141 fungible token, NEP-145 storage management, NEP-171 non-fungible token, NEP-177 NFT metadata, NEP-181 NFT enumeration, NEP-297 events, NEP-366 meta transactions (delegate actions), NEP-461 signature prefixes. All are in `github.com/near/NEPs/tree/master/neps`. NEAR docs `docs.near.org`. near-sdk-rs, near-workspaces-rs, near-api-js. OpenZeppelin Contracts v5 (ERC20, ERC20Permit, ERC2771Forwarder). Foundry book. viem. Privy docs (NEAR is listed as a tier 2 chain: it creates wallets and signs, you broadcast). Web3Auth (now MetaMask Embedded Wallets) lists a NEAR guide. **[VERIFY]** all of these before use; versions change.
