# Andum: Test Plan (Unit, Integration, E2E, UAT, Security)

| | |
|---|---|
| Document | `ANDUM-TEST.md` (companion: `ANDUM-PLAN.md`) |
| Version | 1.0, 11 Nov 2026 |
| Audience | QA agent (WS-F), every workstream agent, the human running UAT |
| Rule | Requirement IDs (`C-01`...) and invariants (`I-1`...) come from `ANDUM-PLAN.md`. Test IDs below reference them. |

---

## 1. Strategy

### 1.1 Levels

| Level | Tooling | Runs | Owner |
|---|---|---|---|
| Unit, Rust | `cargo test` | every commit | WS-A, WS-B |
| Contract integration, NEAR | `near-workspaces` (sandbox) | every commit | WS-A, WS-B |
| Unit, Solidity | Foundry (`forge test`, fuzz, invariant) | every commit | WS-D |
| Unit, backend | Vitest | every commit | WS-C |
| API integration | Vitest + supertest against docker compose (Postgres, Redis, Mailpit) and NEAR sandbox | every PR | WS-C, WS-F |
| Testnet integration | scripts against NEAR testnet and Sepolia networks | before each human gate | WS-F |
| E2E | Playwright (two browser contexts: sender and receiver) | nightly and before UAT | WS-F |
| UAT | Human, scripted, section 11 | Day 3 and Day 4 | Human |
| Security and invariants | property tests, manual checklist | Day 3 | WS-A, WS-F |

### 1.2 Priorities

Each test carries the requirement's priority: **P0** must pass to release, **P1** should pass, **P2** is the showcase and may be reported as known-failing if cut (see `ANDUM-PLAN.md` 9.4).

### 1.3 Conventions

- Test ID format: `<AREA>-<TOPIC>-<NN>`. A test case table gives ID, requirement, steps, expected result.
- "Expect error X" means the call panics or the API returns the code, and **no state changed** (assert by reading state before and after).
- Time in sandbox tests is controlled by fast-forwarding blocks; in testnet tests use short real delays (seconds to minutes) defined by the fixtures.
- Every test cleans up after itself or uses unique account names (`t<random>.ROOT`).
- Failing tests are never deleted or skipped without a line in `docs/DECISIONS.md`.

---

## 2. Environments, fixtures and test data

### 2.1 Environments

| Env | Chains | Use |
|---|---|---|
| `sandbox` | NEAR sandbox (local), anvil for EVM | unit and integration |
| `local-stack` | docker compose: Postgres, Redis, Mailpit; backend pointed at sandbox | API integration |
| `testnet` | NEAR testnet, Ethereum Sepolia, Base Sepolia | testnet integration, E2E, UAT |

### 2.2 Test accounts (created by `scripts/seed.sh`, never real people)

| Alias | Role | Notes |
|---|---|---|
| `alice` | Sender | Funded with all eleven mock assets from faucet |
| `rina` | Receiver | Fresh account, **no** token registrations, holds near-zero NEAR |
| `budi` | Approver | |
| `sari`, `joko` | Extra approvers for quorum tests | |
| `mallory` | Attacker | Funded; used for negative tests |
| `bob` | Second receiver | Used for wrong-receiver tests |
| `evm-alice` | EVM wallet, both Sepolia chains | funded with mock tokens |

### 2.3 Parameter fixtures (`packages/shared/fixtures.ts`)

| Name | Value |
|---|---|
| `T_NOW` | chain time at test start |
| `SHORT` | 60 s for sandbox, 90 s on testnet |
| `ACCEPT_WINDOW` | 1 h for normal, 20 s for expiry tests |
| `PKG_STD` | parts: P0 = 200 USDC (no rule), P1 = 800 USDC (unlock `T_NOW+SHORT`, approver `budi`), P2 = 1.5 g gold (unlock `T_NOW+2*SHORT`) |
| `PKG_MIN` | one part, 1 USDC, no rule |
| `PKG_QUORUM` | one part, 1,200 USDC, unlock `T_NOW+SHORT`, approvers `budi`, `sari`, `alice` (the sender) with threshold 2 |
| `PKG_MAX` | eight parts across eight different tokens |
| `PKG_FIXED` | same as `PKG_STD` but `recipient = rina` and no invite hash |

Amounts are in smallest units with 6 decimals: 200 USDC is `"200000000"`.

---

## 3. Entry and exit criteria

**Entry for UAT**: all P0 automated tests pass on `testnet`; deployments recorded in `deployments/*.json`; seed data loaded; README quick start works.

**Exit (release candidate)**:

1. 100% of P0 tests pass. At least 90% of P1 pass; failures have a written workaround.
2. Invariant tests (section 12) pass with no failing seed across 10,000 randomised sequences.
3. E2E-01 passes three times in a row on `testnet`.
4. No open defect of severity S1 or S2 (section 14).
5. Human signed the UAT sheet (section 11.3).

---

## 4. NEAR core contract (WS-A)

All tests use `near-workspaces`. "Setup" means: deploy `core`, three tokens (`usdc`, `xau`, `idrx`) with `ft_mint`, allowlist them, accounts alice/rina/budi/mallory/bob registered.

### 4.1 Package creation (C-01, C-03)

| ID | Pri | Steps | Expected |
|---|---|---|---|
| C-CREATE-01 | P0 | alice `create_package(PKG_STD)` | Returns id `"0"`; status `AWAITING_FUNDS`; `package_created` event; sender open count is 1 |
| C-CREATE-02 | P0 | 0 parts | Error `INVALID_PARTS` |
| C-CREATE-03 | P0 | 9 parts | Error `INVALID_PARTS` |
| C-CREATE-04 | P0 | 8 parts (`PKG_MAX`) | Succeeds |
| C-CREATE-05 | P0 | Token not on allowlist | Error `TOKEN_NOT_ALLOWED` |
| C-CREATE-06 | P0 | Amount `"0"` | Error `INVALID_AMOUNT` |
| C-CREATE-07 | P0 | Amount `"abc"` or negative | Error `INVALID_AMOUNT` |
| C-CREATE-08 | P0 | Approvers without unlock | Error `INVALID_RULE` |
| C-CREATE-09 | P0 | Unlock time equal to or earlier than now | Error `UNLOCK_IN_PAST` |
| C-CREATE-10 | P0 | `accept_by` in the past, equal to now, or now+91 days | Error `INVALID_EXPIRY` |
| C-CREATE-11 | P0 | `accept_by` exactly now+90 days | Succeeds (boundary) |
| C-CREATE-12 | P0 | Note of 141 characters (multi-byte characters counted by characters) | Error `NOTE_TOO_LONG`; 140 succeeds |
| C-CREATE-13 | P0 | Neither `recipient` nor `invite_hash` | Error `INVALID_PARTS` |
| C-CREATE-14 | P0 | Both `recipient` and `invite_hash` | Error `INVALID_PARTS` |
| C-CREATE-15 | P0 | 51st open package from the same sender | Error `LIMIT_EXCEEDED`; another sender still can |
| C-CREATE-16 | P0 | Contract paused | Error `PAUSED` |
| C-CREATE-17 | P0 | Contract balance below storage need | Error `STORAGE_RESERVE_LOW`, no partial state |
| C-CREATE-18 | P0 | Two packages in parallel | Distinct ids, no overwrite |
| C-CREATE-19 | P0 | Create then read `get_package` | All fields match input; no field editable afterwards (no method exists) |
| C-CREATE-20 | P1 | Same token in two parts | Allowed; two independent parts |
| C-CREATE-21 | P0 | Six approvers on one part | `INVALID_APPROVERS` |
| C-CREATE-22 | P0 | Duplicate approver (also differing only by case is not applicable to NEAR ids; test exact duplicates) | `INVALID_APPROVERS` |
| C-CREATE-23 | P0 | Threshold 0, or greater than the number of approvers | `INVALID_APPROVERS` |
| C-CREATE-24 | P0 | Threshold omitted with three approvers | Defaults to 1 |
| C-CREATE-25 | P0 | Fixed recipient is also listed as an approver | `INVALID_APPROVERS` |
| C-CREATE-26 | P0 | The sender is listed as the only approver (self-approval) | Succeeds; `get_package` shows `approvers = [alice]`, `threshold = 1` |
| C-CREATE-27 | P1 | `theme` outside the list | `INVALID_THEME`; each valid theme succeeds; omitted theme reads as `none` |
| C-CREATE-28 | P1 | `note` and `theme` read back through `get_package` and in the `package_created` event | Equal to input |

### 4.2 Funding (C-02, C-03)

| ID | Pri | Steps | Expected |
|---|---|---|---|
| C-FUND-01 | P0 | alice `ft_transfer_call` exact amount for part 0 | `funded == amount`; `part_funded` event; token balance of core increased |
| C-FUND-02 | P0 | Fund every part exactly | Status `FUNDED`; `package_funded` once |
| C-FUND-03 | P0 | Send more than needed | Contract keeps only the needed amount; excess returns to alice; `deposit_refunded` event; alice net spend equals needed |
| C-FUND-04 | P0 | Fund part in two instalments | `funded` accumulates; status flips only after the last |
| C-FUND-05 | P0 | mallory funds alice's package | `WRONG_SENDER`; full refund to mallory |
| C-FUND-06 | P0 | Wrong token (idrx sent to a usdc part) | `WRONG_TOKEN`; full refund |
| C-FUND-07 | P0 | `msg` missing, empty, non-JSON, unknown package, part id out of range | `BAD_MSG` / `PACKAGE_NOT_FOUND` / `PART_NOT_FOUND`; full refund in each case |
| C-FUND-08 | P0 | Fund after the package is `FUNDED` | Entire amount refunded (`PACKAGE_NOT_ACTIVE`) |
| C-FUND-09 | P0 | Fund a reclaimed package | Entire amount refunded |
| C-FUND-10 | P0 | Direct call to `ft_on_transfer` by a non-token account (mallory) | Rejected: `WRONG_TOKEN` (predecessor is not the part's token); no state change |
| C-FUND-11 | P0 | Funding while paused | Entire amount refunded |
| C-FUND-12 | P0 | `ft_transfer_call` without 1 yoctoNEAR | Fails at the token (not a core concern); confirm no state change |

### 4.3 Accept and NFT (C-04, C-08)

| ID | Pri | Steps | Expected |
|---|---|---|---|
| C-ACCEPT-01 | P0 | rina accepts with correct secret | Status `ACCEPTED`; `owner = rina`; NFT id equals package id owned by rina; `nft_mint` and `package_accepted` events |
| C-ACCEPT-02 | P0 | Wrong secret | `INVITE_SECRET_INVALID` |
| C-ACCEPT-03 | P0 | Accept before fully funded | `PACKAGE_NOT_ACTIVE` |
| C-ACCEPT-04 | P0 | Second accept (rina or mallory with the right secret) | `ALREADY_ACCEPTED`; owner unchanged |
| C-ACCEPT-05 | P0 | Accept after `accept_by` | `INVITE_EXPIRED` |
| C-ACCEPT-06 | P0 | Fixed recipient: bob accepts a package for rina | `NOT_INVITED_ACCOUNT` |
| C-ACCEPT-07 | P0 | Fixed recipient: rina accepts without secret | Succeeds |
| C-ACCEPT-08 | P0 | Accept registers storage for each distinct token at the token contract | `storage_balance_of(rina)` non-null for every token in the package; rina's own NEAR balance unchanged |
| C-ACCEPT-09 | P0 | Accept with `PKG_MAX` (eight tokens) | Succeeds within gas limit (S-03); record gas used in `VERIFY-LOG.md` |
| C-ACCEPT-10 | P0 | Accept while paused | `PAUSED` |
| C-NFT-01 | P1 | `nft_transfer` by rina to bob while parts are untaken | `PASS_NOT_TRANSFERABLE` |
| C-NFT-02 | P1 | `nft_transfer_call` | `PASS_NOT_TRANSFERABLE` |
| C-NFT-03 | P1 | `nft_token(id)` and `nft_tokens_for_owner(rina)` and `nft_total_supply` | Correct id, owner, metadata name `Andum package #<id>`, supply equals accepted packages |
| C-NFT-04 | P1 | NFT metadata views work with the backend offline | Pass (no external call) |
| C-NFT-05 | P1 | NFT `description` equals the note when present | Pass |

### 4.4 Approval (C-05)

| ID | Pri | Steps | Expected |
|---|---|---|---|
| C-APPROVE-01 | P0 | budi approves part 1 of an accepted package, before its date | `approved = true`; `part_approved` event |
| C-APPROVE-02 | P0 | budi approves twice | No error; one event only |
| C-APPROVE-03 | P0 | mallory approves | `NOT_APPROVER` |
| C-APPROVE-04 | P0 | alice (sender) or rina (receiver) approves | `NOT_APPROVER` |
| C-APPROVE-05 | P0 | Approve a part that has no approvers | `NOT_APPROVER` |
| C-APPROVE-10 | P0 | `PKG_QUORUM`: `budi` approves | `approvals = [budi]`; `approved = false`; event `part_approved` with `threshold_met = false`; status still waiting |
| C-APPROVE-11 | P0 | `budi` approves again | No-op, no event, `approvals` unchanged (a person counts once) |
| C-APPROVE-12 | P0 | `sari` approves after `budi` | `approved = true`; event with `threshold_met = true` |
| C-APPROVE-13 | P0 | `alice` (sender, named approver) approves after the threshold is met | Recorded, harmless; no second `threshold_met = true` event |
| C-APPROVE-14 | P0 | Outsider (`mallory`) approves | `NOT_APPROVER` |
| C-APPROVE-15 | P0 | Claim after date with one of two approvals | `APPROVAL_MISSING`; after the second approval the claim succeeds |
| C-APPROVE-16 | P0 | Self-approval: sender is the only approver; sender approves | Part approved; receiver can take after the date |
| C-APPROVE-17 | P0 | Receiver (invite-based) is one of the approvers and tries to accept | `RECEIVER_IS_APPROVER`; package stays `FUNDED` |
| C-APPROVE-18 | P0 | Receiver becomes owner, then calls `approve_part` on their own package (if they were somehow named) | Cannot happen: covered by C-APPROVE-17; also assert `NOT_APPROVER` for a non-named owner |
| C-APPROVE-19 | P1 | Views: `approvals`, `threshold`, `approved` and the status for 0, 1, 2 approvals | Match the table in plan 5.7 |
| C-APPROVE-20 | P1 | Parallel approvals from two approvers in the same block | Both counted once; no lost update |
| C-APPROVE-06 | P0 | Approve before the package is funded | `PACKAGE_NOT_ACTIVE` |
| C-APPROVE-07 | P0 | Approve unknown part | `PART_NOT_FOUND` |
| C-APPROVE-08 | P0 | Approve after the package is reclaimed | `PACKAGE_NOT_ACTIVE` |
| C-APPROVE-09 | P1 | Approval after the part was taken | Rejected or harmless no-op; assert funds unaffected |
| C-APPROVE-90 | P1 | **Known limitation**: the approvers never reach the threshold (including when too few are reachable, for example 2 of 2 and one is gone) | Part stays `WAITING_*` forever; assert the contract offers no refund path; documented, not a defect |

### 4.5 Claim (C-06)

| ID | Pri | Steps | Expected |
|---|---|---|---|
| C-CLAIM-01 | P0 | rina takes part 0 (no rule) | `claim_started`, then `part_claimed`; rina's balance up by the amount; core's balance down by the same; status `TAKEN` |
| C-CLAIM-02 | P0 | Take part 1 before date | `TIME_NOT_REACHED`; no state change |
| C-CLAIM-03 | P0 | Take part 1 after date, no approval | `APPROVAL_MISSING` |
| C-CLAIM-04 | P0 | Take part 1 before date and without approval | `TIME_NOT_REACHED` (reported first) |
| C-CLAIM-05 | P0 | Approved before date, then date passes | Take succeeds |
| C-CLAIM-06 | P0 | Date passes, then approved | Take succeeds |
| C-CLAIM-07 | P0 | Take part 2 (date only) after date | Succeeds |
| C-CLAIM-08 | P0 | Take at exactly the unlock block timestamp | Succeeds when `now >= unlock_ns`; fails one nanosecond earlier (boundary; use contract-level unit test with injected time) |
| C-CLAIM-09 | P0 | Take part 0 twice sequentially | Second: `ALREADY_TAKEN`; balance changed once |
| C-CLAIM-10 | P0 | mallory takes | `NOT_PASS_OWNER` |
| C-CLAIM-11 | P0 | alice (sender) takes | `NOT_PASS_OWNER` |
| C-CLAIM-12 | P0 | Sender or approver tries to redirect (no destination argument exists) | Method signature has no receiver parameter (static check) |
| C-CLAIM-13 | P0 | Claim on a `FUNDED` but unaccepted package | `PACKAGE_NOT_ACTIVE` |
| C-CLAIM-14 | P0 | Claim while paused | `PAUSED` |
| C-CLAIM-15 | P0 | rina not registered at token before take | Take registers her (storage paid by core) and succeeds |
| C-CLAIM-16 | P0 | Take all parts | Sender's open count decremented once; all `TAKEN`; core's balances for the package zero |
| C-CLAIM-30 | P0 | Two `claim` calls for the same part in the same block | Exactly one transfer; the other fails `TRANSFER_PENDING` or `ALREADY_TAKEN`; balance moved once |
| C-CLAIM-31 | P0 | Token's `ft_transfer` fails (use a mock token with a failure switch) | Part returns to `LOCKED`; `claim_failed`; no tokens lost; retry succeeds after switch off |
| C-CLAIM-32 | P0 | Callback runs with a stale attempt id (simulate by forcing a second attempt) | Stale callback ignored; final state consistent |
| C-CLAIM-33 | P0 | Out-of-gas in the middle of the chain (attach too little gas) | No part marked `TAKEN` unless the transfer happened; state is `LOCKED` or `PENDING`-then-resolved; document recovery steps |
| C-CLAIM-34 | P0 | `claim` for different parts of one package in the same block | Both succeed independently |
| C-CLAIM-35 | P1 | `PENDING` part is visible as `PROCESSING` in views | Pass |
| C-CLAIM-36 | P1 | Claim where the token's transfer succeeds but the callback is delayed | View shows `PROCESSING`; once resolved `TAKEN` |

### 4.6 Reclaim (C-07)

| ID | Pri | Steps | Expected |
|---|---|---|---|
| C-RECLAIM-01 | P0 | Funded, unaccepted, deadline passed: alice reclaims | All funded tokens return to alice; status `RECLAIMED`; `package_reclaimed`; open count decremented |
| C-RECLAIM-02 | P0 | Before the deadline (funded) | `NOT_RECLAIMABLE` |
| C-RECLAIM-03 | P0 | Partially funded (`AWAITING_FUNDS`): reclaim any time | Funded portions returned |
| C-RECLAIM-04 | P0 | After accept | `NOT_RECLAIMABLE` |
| C-RECLAIM-05 | P0 | Second reclaim | `ALREADY_RECLAIMED`; no double refund |
| C-RECLAIM-06 | P0 | Non-sender reclaims | `NOT_SENDER` |
| C-RECLAIM-07 | P0 | Accept racing reclaim at the deadline | Exactly one wins; funds are never both refunded and owned by the receiver (I-2) |
| C-RECLAIM-08 | P0 | Token transfer fails during reclaim (failure switch) | Status stays `RECLAIMED`; tokens remain refundable; retry after switch off returns them once |
| C-RECLAIM-09 | P0 | Accept after reclaim | `PACKAGE_NOT_ACTIVE` |
| C-RECLAIM-10 | P1 | Reclaim a package with eight parts | Within gas limit |

### 4.7 Views and status (C-11)

| ID | Pri | Steps | Expected |
|---|---|---|---|
| C-VIEW-01 | P0 | `PKG_STD` accepted, at `T_NOW` | Part 0 `OPEN`; part 1 `WAITING_DATE_AND_APPROVAL` with reason `TIME_NOT_REACHED`; part 2 `WAITING_DATE` |
| C-VIEW-02 | P0 | After SHORT, no approval | Part 1 `WAITING_APPROVAL` reason `APPROVAL_MISSING`; part 2 `OPEN` |
| C-VIEW-03 | P0 | After approval before date | Part 1 `WAITING_DATE` |
| C-VIEW-04 | P0 | Unaccepted package | Untaken parts `NOT_ACCEPTED` reason `PACKAGE_NOT_ACTIVE` |
| C-VIEW-05 | P0 | `get_packages_by_sender` and `get_packages_by_owner` pagination (limit, from) | Stable order, no duplicates, correct totals |
| C-VIEW-06 | P0 | Status in view always equals what `claim` would do (property test: for random states, `status == OPEN` iff `claim` succeeds) | Holds |
| C-VIEW-07 | P1 | `storage_report` after N packages | Balances consistent with measured storage |
| C-VIEW-08 | P0 | Unknown id | `PACKAGE_NOT_FOUND` or null as specified; documented once |

### 4.7b Events and admin (C-09, C-10)

| ID | Pri | Steps | Expected |
|---|---|---|---|
| C-EVENT-01 | P0 | Run the full happy path and collect logs | Every event in plan 3.6 appears exactly once with correct JSON fields; each parses against the schema in `packages/shared` |
| C-EVENT-02 | P0 | Failed calls | No event emitted |
| C-ADMIN-01 | P0 | Non-owner calls `set_paused`, `set_allowed_tokens`, `set_limits`, `top_up`, `migrate` | `NOT_ADMIN` |
| C-ADMIN-02 | P0 | Owner pauses | Create, fund, accept, claim, approve, reclaim all refused or refunded |
| C-ADMIN-03 | P0 | Owner removes a token from the allowlist | Existing packages with that token can still be taken; new packages refuse it |
| C-ADMIN-04 | P0 | Static check: no public method callable by the owner transfers tokens (I-1) | Verified by scanning the ABI/method list and by an attempt to drain with owner key in a test |
| C-ADMIN-05 | P1 | `migrate` after upgrade with existing packages | State preserved |

---

## 5. NEAR mock tokens and bridge (WS-B)

### 5.1 Mock token (F-01, F-02)

| ID | Pri | Steps | Expected |
|---|---|---|---|
| F-MINT-01 | P0 | `ft_mint(rina, perCall)` | Balance up; account auto-registered; no storage cost to rina |
| F-MINT-02 | P0 | `ft_mint` above per-call cap | `FAUCET_CAP_PER_CALL` |
| F-MINT-03 | P0 | Repeated mints exceeding daily cap within 24 h | `FAUCET_CAP_DAILY`; succeeds again after the window (fast-forward) |
| F-MINT-04 | P0 | Daily cap is per account | Another account unaffected |
| F-MINT-05 | P0 | `faucet_remaining` view | Matches caps minus used |
| F-NEP-01 | P0 | NEP-141 conformance: `ft_transfer`, `ft_transfer_call`, `ft_total_supply`, `ft_balance_of`, `ft_metadata` | Pass (decimals 6, symbol per asset) |
| F-NEP-02 | P0 | `ft_transfer_call` without 1 yocto | Rejected |
| F-NEP-03 | P0 | NEP-145: `storage_deposit`, `storage_balance_of`, `storage_unregister` | Pass |
| F-ROLE-01 | P2 | `ft_mint_privileged` and `ft_burn_privileged` by a non-minter | Rejected |
| F-ROLE-02 | P2 | `ft_mint_call` by a non-minter | Rejected |
| F-ROLE-03 | P2 | `ft_mint_call` to core with `msg` for an existing package; core accepts partial | Surplus is burned and reported; bridge refund path tested in B-IN-04 |
| F-DEPLOY-01 | P0 | All eleven token instances deployed with correct symbols and caps | Verified from `deployments/near.testnet.json` |

### 5.2 Bridge contract (B-01)

| ID | Pri | Steps | Expected |
|---|---|---|---|
| B-IN-01 | P2 | Relayer `bridge_in` plain | Receiver minted; `bridge_in_done` |
| B-IN-02 | P2 | Same `(src_chain, src_nonce)` twice | Second is a no-op; minted once (I-8) |
| B-IN-03 | P2 | Caller is not the relayer | `BRIDGE_NOT_RELAYER` |
| B-IN-04 | P2 | `bridge_in` with `fund`, core accepts only part of the amount | Surplus minted to the receiver; total minted equals amount |
| B-IN-05 | P2 | Token not bridgeable (gold, stocks) | Rejected |
| B-IN-06 | P2 | Same nonce from a different source chain | Treated as a different transfer |
| B-OUT-01 | P2 | User `ft_transfer_call(bridge, amount, msg)` | Tokens burned; outbound record with next nonce; `bridge_out` event |
| B-OUT-02 | P2 | Invalid destination address, unknown chain | Refunded; no record |
| B-OUT-03 | P2 | Not-bridgeable token | Refunded |
| B-OUT-04 | P2 | Nonces strictly increasing, no gaps under parallel calls | Pass |
| B-OUT-05 | P2 | `get_outbound_range` pagination | Pass |

---

## 6. EVM contracts (WS-D)

### 6.1 MockERC20 (E-01)

| ID | Pri | Steps | Expected |
|---|---|---|---|
| E-FAUCET-01 | P2 | `faucet(to, perCall)` | Minted |
| E-FAUCET-02 | P2 | Above per-call or over rolling daily | Reverts `FaucetCapPerCall` / `FaucetCapDaily` |
| E-FAUCET-03 | P2 | Fuzz: sums never exceed daily cap in any 24 h window | Holds |
| E-TOKEN-01 | P2 | 6 decimals, symbol, name per asset | Pass |
| E-TOKEN-02 | P2 | `mint` by non-minter | Reverts |
| E-TOKEN-03 | P2 | Permit valid, expired, wrong signer, replayed | Valid works, others revert |

### 6.2 Gateway (E-02) and forwarder (E-03)

| ID | Pri | Steps | Expected |
|---|---|---|---|
| E-GW-01 | P2 | `depositForNear` with allowance | Burns amount; `DepositedForNear` with incrementing nonce |
| E-GW-02 | P2 | Amount zero, over `maxPerTx`, asset disabled, empty or >64-byte account | Reverts |
| E-GW-03 | P2 | `depositForNearWithPermit` | Works with one transaction; bad permit reverts |
| E-GW-04 | P2 | `release` by relayer | Mints; `Released` |
| E-GW-05 | P2 | `release` same NEAR nonce twice | Second reverts (I-8) |
| E-GW-06 | P2 | `release` by non-relayer | Reverts |
| E-GW-07 | P2 | Paused: deposit and release revert | Pass |
| E-GW-08 | P2 | Reentrancy attempt with a malicious token | Blocked |
| E-GW-09 | P2 | Invariant fuzz: total supply minted via gateway equals sum of released nonces; each nonce once | Holds |
| E-GW-10 | P2 | `Ownable2Step` ownership transfer requires acceptance | Pass |
| E-FWD-01 | P2 | Valid forward request signed by user, executed by relayer | `_msgSender()` is the user; user pays no gas |
| E-FWD-02 | P2 | Wrong nonce, expired deadline, wrong signer, replay | Revert |
| E-FWD-03 | P2 | Gasless deposit: user signs permit and forward request; relayer submits | Deposit succeeds, user ETH balance unchanged |
| E-DEPLOY-01 | P2 | Both chains: eleven tokens, forwarder, gateway deployed, roles set | Matches `deployments/sepolia.json` and `base-sepolia.json` |

---

## 7. Backend API (WS-C)

Tests run against the `local-stack` with NEAR sandbox. Unless stated, P0.

### 7.1 Auth, bootstrap, time (A-01, A-02)

| ID | Steps | Expected |
|---|---|---|
| A-AUTH-01 | `POST /auth/session` with valid local-key challenge | 200, cookie httpOnly, user row created with the account id |
| A-AUTH-02 | Wrong signature, replayed nonce, expired nonce | 401 `UNAUTHENTICATED` |
| A-AUTH-03 | Protected endpoint without cookie | 401 |
| A-AUTH-04 | Provider-token login (Privy or Web3Auth) with a stub verifier in tests | Session created; invalid token rejected (P1) |
| A-AUTH-05 | Session expiry | 401 after expiry |
| A-BOOT-01 | New user `POST /accounts/bootstrap` | Account funded with `TOPUP_NEAR`; `created: true` |
| A-BOOT-02 | Second call | `created: false`, no extra funding |
| A-BOOT-03 | Per-user and per-day cap exceeded | 429 `BOOTSTRAP_LIMIT` |
| A-BOOT-04 | Idempotency-Key reuse | Same response, one transfer |
| A-TIME-01 | `GET /time` | `chain_ns` within 10 s of the sandbox clock |

### 7.2 Invites (A-03)

| ID | Steps | Expected |
|---|---|---|
| A-INV-01 | `POST /invites` | Returns id and base64 hash; DB row has encrypted secret; secret never in the response or logs |
| A-INV-02 | `attach` with a real package whose `invite_hash` matches | `ATTACHED`; invite email delivered to Mailpit once |
| A-INV-03 | `attach` with a package of another sender, or a hash mismatch | 403 `FORBIDDEN` or `VALIDATION_FAILED` |
| A-INV-04 | `attach` twice | Idempotent; one email |
| A-INV-05 | `GET /invites/{id}/public` before attach | 409 `INVITE_NOT_ATTACHED` |
| A-INV-06 | `public` after attach | Package summary from chain, masked email, no secret |
| A-INV-07 | `verify/start` | Email with 6-digit code in Mailpit; `resend_after_s` returned |
| A-INV-08 | `verify/start` repeated within 60 s | 429 `RATE_LIMITED` |
| A-INV-09 | `verify/confirm` right code | Returns `package_id` and `invite_secret`; invite `VERIFIED` |
| A-INV-10 | Wrong code five times | `OTP_LOCKED`; right code afterwards still refused until new code |
| A-INV-11 | Code after 10 minutes | `OTP_EXPIRED` |
| A-INV-12 | Code reuse | `OTP_INVALID` |
| A-INV-13 | Invite past `accept_by` | `INVITE_EXPIRED` on start and confirm |
| A-INV-14 | Secret hashes to the on-chain `invite_hash` (end-to-end with sandbox contract `accept_package`) | Accept succeeds |
| A-INV-15 | Unknown invite id | 404 `INVITE_NOT_FOUND` |
| A-LINK-01 | `GET /links/check` for a free valid slug | `available: true` |
| A-LINK-02 | Check slugs: too short (`ab`), too long (33), uppercase, spaces, double hyphen, leading or trailing hyphen, non-ASCII | `SLUG_INVALID` for each |
| A-LINK-03 | Check each reserved name and a name starting with `andum` | `SLUG_RESERVED` |
| A-LINK-04 | Check a slug used by another invite | `SLUG_TAKEN` with a suggestion; response does not reveal the owner |
| A-LINK-05 | `PATCH /invites/{id}/link` with a valid slug, title and `show_amount` | Saved; response `url` and `preview` match |
| A-LINK-06 | `PATCH` by a user who is not the sender | 403 `FORBIDDEN` |
| A-LINK-07 | `PATCH` after the package is accepted | `LINK_LOCKED` |
| A-LINK-08 | Change the slug; open the old one within 24 hours, and after | Redirects, then 404 |
| A-LINK-09 | Two users claim the same slug at the same moment | Exactly one succeeds; the other gets `SLUG_TAKEN` (unique constraint) |
| A-LINK-10 | More than 10 changes in an hour; more than 30 checks in a minute | 429 `RATE_LIMITED` |
| A-LINK-11 | Title with HTML (`<script>`, `<img onerror>`), 61 characters, emoji | Plain text stored, escaped on output; 61 characters rejected `VALIDATION_FAILED`; emoji kept |
| A-LINK-12 | `GET /p/{slug}` page source | Contains `og:title`, `og:description`, `og:image`, `twitter:card`; no email address; amounts absent when `show_amount` is false and present when true |
| A-LINK-13 | `GET /p/{slug}/og.png` | 1200x630 PNG; no amounts when hidden; renders the six themes without error |
| A-LINK-14 | Open `/p/{slug}` and use the invite flow end to end | Behaves exactly like the invite id route; accepting still requires the email code (A-INV-09) |
| A-INV-16 | Confirm, then second confirm with a fresh code | Allowed only while the package is unaccepted; after accept, `INVITE_NOT_FOUND` or expired |

### 7.3 Packages, notifications, faucet (A-05, A-06, A-07)

| ID | Steps | Expected |
|---|---|---|
| A-PKG-01 | `GET /packages?role=sender` for alice | Only her packages; paginates with cursor |
| A-PKG-02 | `role=owner` for rina after accept | Her package |
| A-PKG-03 | `role=approver` for budi | Packages where he is named on a part |
| A-PKG-04 | Mallory requests `GET /packages/{id}` of another's package | 403 (not a party) |
| A-PKG-05 | Stale cache (older than 10 s) triggers a chain read | Returned view equals chain |
| A-PKG-06 | Cache says `LOCKED` but chain says `TAKEN` | API returns the chain value |
| A-PKG-07 | `GET /packages/{id}/nft.svg` | Valid SVG with package id and part count; no personal data |
| A-PKG-08 | `GET /packages/{id}/events` | Ordered events from `chain_events` |
| A-NOTIF-01 | Prefs: set and read | Persisted |
| A-FAU-01 | `POST /faucet/near` within caps | Tokens minted to the caller only |
| A-FAU-02 | Over cap or per-IP limit | 429 `FAUCET_CAP` |
| A-FAU-03 | `asset_id` unknown | 400 `VALIDATION_FAILED` |
| A-FAU-04 | Kill switch on | 503 `UPSTREAM_UNAVAILABLE` |
| A-API-01 | OpenAPI conformance: every endpoint's request and response validate against `packages/shared/openapi.yaml` | Pass |
| A-API-02 | Idempotency: same key, different body | 409 `IDEMPOTENCY_CONFLICT` |
| A-API-03 | `healthz` always 200; `readyz` 503 when Postgres, Redis or RPC is down | Pass |
| A-API-04 | SSE `/stream` delivers `package.updated` after a relayed `approve_part` within 5 s | Pass (P1) |
| A-API-05 | CORS blocks an unknown origin | Pass |

---

## 8. Relayer and policy engine (A-04)

The policy function is pure; test it with a table of inputs. Every rule R1 to R11 has an allow case and a deny case at its boundary. Names `A-RELAY-<rule>-<nn>`.

| ID | Rule | Case | Expected |
|---|---|---|---|
| A-RELAY-R1-01 | R1 | Delegate `sender_id` equals session account | Allow |
| A-RELAY-R1-02 | R1 | Different account | Deny `R1` |
| A-RELAY-R2-01 | R2 | Valid signature | Allow |
| A-RELAY-R2-02 | R2 | Tampered args after signing | Deny `R2` |
| A-RELAY-R2-03 | R2 | Signature from a key not on the account | Deny `R2` |
| A-RELAY-R3-01 | R3 | `max_block_height` = current + 1 and current + 200 | Allow |
| A-RELAY-R3-02 | R3 | Current, current - 1, current + 201 | Deny `R3` (`RELAY_EXPIRED` for expired) |
| A-RELAY-R4-01 | R4 | Nonce = key nonce + 1 | Allow |
| A-RELAY-R4-02 | R4 | Nonce equal to or below key nonce | Deny `R4` |
| A-RELAY-R5-01 | R5 | Each allowlisted `(receiver, method)` | Allow |
| A-RELAY-R5-02 | R5 | Unlisted receiver, unlisted method (`ft_transfer`, `storage_unregister`, `add_key`, `delete_account`, `transfer`) | Deny `R5` |
| A-RELAY-R5-03 | R5 | Two actions in one delegate | Deny `R5` |
| A-RELAY-R5-04 | R5 | A non-`FunctionCall` action (Transfer, DeployContract, AddKey, DeleteKey, DeleteAccount, Stake) | Deny `R5` |
| A-RELAY-R6-01 | R6 | `ft_transfer_call` with exactly 1 yocto | Allow |
| A-RELAY-R6-02 | R6 | `ft_transfer_call` with 0 or 2 yocto or any other method with a non-zero deposit | Deny `R6` |
| A-RELAY-R7-01 | R7 | Gas equal to the cap | Allow |
| A-RELAY-R7-02 | R7 | Gas above the cap | Deny `R7` |
| A-RELAY-R8-01 | R8 | `ft_transfer_call` to core or bridge with valid msg | Allow |
| A-RELAY-R8-02 | R8 | `ft_transfer_call` to any other receiver (mallory), invalid msg | Deny `R8` |
| A-RELAY-R8-03 | R8 | `ft_mint` for another account | Deny `R8` |
| A-RELAY-R9-01 | R9 | 30 submissions in a minute | Allow the 30th |
| A-RELAY-R9-02 | R9 | 31st | Deny `R9` (`RATE_LIMITED`); resets after the window |
| A-RELAY-R9-03 | R9 | Daily budget exhausted | Deny `R9` for everyone |
| A-RELAY-R10-01 | R10 | Same payload twice | Second denied `RELAY_DUPLICATE` |
| A-RELAY-R11-01 | R11 | Kill switch on | Deny `R11` |
| A-RELAY-EX-01 | all | Property test: random delegate actions never allow anything outside the allowlist | Holds |

Relayer behaviour (integration, sandbox):

| ID | Steps | Expected |
|---|---|---|
| A-RELAY-INT-01 | Submit a valid `create_package` delegate action | Job `SUCCEEDED`; tx hash; package exists; **user's NEAR balance unchanged** (N-01) |
| A-RELAY-INT-02 | Submit `ft_transfer_call` | User's balance down by at most 1 yoctoNEAR; tokens moved; core event parsed |
| A-RELAY-INT-03 | Contract panics (`TIME_NOT_REACHED`) | Job `FAILED` with `RELAY_CHAIN_FAILURE` carrying `TIME_NOT_REACHED`; no retry |
| A-RELAY-INT-04 | Transport error (RPC down) then back | Retried, one transaction on chain |
| A-RELAY-INT-05 | Relayer key nonce conflict (submit 20 jobs concurrently) | All succeed, none duplicated |
| A-RELAY-INT-06 | Same `client_request_id` twice | One job |
| A-RELAY-INT-07 | Relayer balance low | `readyz` warns; jobs fail clearly with `UPSTREAM_UNAVAILABLE` |
| A-RELAY-INT-08 | `GET /relay/{id}` for another user's job | 403 |
| A-RELAY-INT-09 | Relayer key leak drill: assert that the relayer account holds only gas funds and no tokens or roles | Pass (I-9) |

---

## 9. Reconciler, notifier and bridge worker

### 9.1 Reconciler

| ID | Steps | Expected |
|---|---|---|
| A-REC-01 | Relay success parses `EVENT_JSON` logs into `chain_events` | One row per event, unique per `(chain, tx, log_index)` |
| A-REC-02 | Re-process same tx | No duplicates |
| A-REC-03 | Periodic refresh updates a part from `LOCKED` to `TAKEN` | Cache equals chain within 20 s |
| A-REC-04 | Chain reads fail | Cache untouched; error metric increments |
| A-REC-05 | Restart mid-run | Resumes without loss |

### 9.2 Notifier (A-06)

| ID | Steps | Expected |
|---|---|---|
| A-NOT-01 | Part reaches unlock time | One `part_ready` email in Mailpit within 60 s |
| A-NOT-02 | Part with approvers: only after the threshold is met and the date has passed | Email only when both met (1 of 2 approvals sends nothing) |
| A-NOT-08 | Package accepted with a part that has three approvers | Each approver gets one `approval_request` email; repeated runs send none; an approver who already approved is not emailed again |
| A-NOT-03 | Worker restarted or two instances run | Still exactly one email (unique `dedupe_key`) |
| A-NOT-04 | Part taken before the email is sent | Skipped (re-check shows not `OPEN`) |
| A-NOT-05 | Mail provider down | Retries with backoff, then `FAILED`; no duplicates after recovery |
| A-NOT-06 | Email disabled in prefs | `SKIPPED` |
| A-NOT-07 | Email body | Receiver's name and the package, the part amount, a link; no secret; plain wording per copy deck |

### 9.3 Bridge worker (A-08, P2)

| ID | Steps | Expected |
|---|---|---|
| A-BRIDGE-01 | EVM deposit on anvil, worker waits for confirmations, mints on NEAR sandbox | `DONE`; balance up; one mint |
| A-BRIDGE-02 | Restart worker mid-way, replay logs | No double mint (I-8) |
| A-BRIDGE-03 | Reorg before confirmation (anvil revert) | `FAILED: REORGED`; no destination action |
| A-BRIDGE-04 | NEAR outbound burn, worker releases on EVM | `DONE`; one mint on EVM |
| A-BRIDGE-05 | Destination call fails then recovers | Retried; exactly one execution |
| A-BRIDGE-06 | Deposit with fund target | NEAR side funds the package part; surplus handled |
| A-BRIDGE-07 | Deposit for an unregistered or malformed NEAR account | `FAILED` with clear error; refund path documented |
| A-BRIDGE-08 | Kill switch | Worker idle, status visible |
| A-BRIDGE-09 | `GET /bridge/transfers/{id}` reflects status changes and SSE emits `bridge.updated` | Pass |

---

## 10. End-to-end (WS-F, Playwright on `testnet`)

Two browser contexts (sender, receiver), a third for the approver. Short times from fixtures. Mailpit or the real provider's test inbox for emails.

| ID | Pri | Scenario | Pass criteria |
|---|---|---|---|
| E2E-01 | P0 | **Demo script** (plan 1.4): mint, build `PKG_STD`, fund, receiver opens link, verifies email, accepts, takes part 0, is refused part 1, approver approves, takes part 1, takes part 2 | All steps pass; the readable reasons shown for each refusal; zero gas debited from any user (assert NEAR balances); total run under 6 minutes |
| E2E-02 | P0 | Unaccepted package reclaimed after the deadline (use 20 s window) | Funds returned to sender; link shows "expired" |
| E2E-03 | P0 | Wrong person: mallory opens the link and cannot accept without the email code | Blocked; package unchanged |
| E2E-04 | P0 | Double take: click Take twice quickly, and from two tabs | One payout; UI shows "Already on its way" or "Taken" |
| E2E-05 | P1 | Notification: part opens, email arrives, link opens the right package | Email within 60 s; one only |
| E2E-06 | P1 | Live update: receiver's page changes status without reload after the approver approves | Within 5 s |
| E2E-07 | P2 | Cross-chain in: mint mock USDC on Base Sepolia, send to NEAR, arrive in the Andum balance | Balance up; transfer record `DONE` |
| E2E-08 | P2 | Cross-chain out: send part of the received USDC to a Sepolia address | EVM balance up; one mint |
| E2E-09 | P1 | Phone viewport (390 px wide) for sender and receiver flows | No horizontal scroll; every action reachable |
| E2E-10 | P1 | Backend restart mid-flow (kill API and workers for 30 s) | No loss; the flow completes after restart |
| E2E-11 | P0 | `PKG_MAX` with eight tokens: fund, accept, take all | Works within gas; UI shows all parts |
| E2E-13 | P1 | Quorum: part with approvers `budi`, `sari`, `alice` and threshold 2. Receiver is refused with "2 more approvals needed" wording, `budi` approves (receiver page shows 1 of 2), still refused, `sari` approves, receiver takes | All steps pass; progress text always matches the chain |
| E2E-14 | P1 | Opening moment: sender picks each of the six themes in turn, adds a note, previews, sends; receiver accepts | Each theme plays once after accept; the note shows after accept and not before; with the "reduce motion" setting on, no particles play and the note and button are visible immediately; the gift theme waits for a tap |
| E2E-15 | P1 | Custom link: sender renames the link to `rina-audit-bonus` (first tries a taken name and sees the message), sets a title, leaves the amount hidden, watches the chat preview card update, copies the link. Receiver opens `/p/rina-audit-bonus` | The browser bar shows the custom link; the headline is the custom title; accepting works; after acceptance the sender can no longer change the link |
| E2E-12 | P1 | Signer fallback: run E2E-01 with `LocalKeySigner` and, if S-02 passed, with the embedded provider | Both pass |

Each E2E records a video and the transaction hashes, and attaches explorer links in the report.

---

## 11. User acceptance testing (human)

### 11.1 Prerequisites

Staging stack up, seed data loaded, two browsers or one browser plus a phone, access to the email inbox used for the receiver, README open.

### 11.2 Scripts

Each script is a list of steps with an expected result. The tester ticks pass or fail and writes a note. Pass means the user could do it without help and the screen said what they expected.

| ID | Persona | Task | Pass criteria |
|---|---|---|---|
| U-01 | Sender (a person paying a contributor) | Get test money, build a three-part package, send it | Done in under 5 minutes; every screen understandable; "Network fee: Covered" visible; no wallet or gas jargon |
| U-02 | Receiver | Open the email link on a phone, see what is inside **before** accepting, accept | Sees amounts, who sent it and when each part opens; accept takes under 2 minutes including the email code |
| U-03 | Receiver | Try to take a closed part | Gets a plain reason and the date or the name of the approver; no raw error code visible |
| U-04 | Receiver | Take an open part | Money appears; part shows "Taken"; balance updated |
| U-05 | Approver | Receive the approval request, approve one part | One clear action; confirmation shown |
| U-13 | Sender, receiver | Choose a theme and a note, preview it, send. As the receiver accept and take a part | The preview matches what the receiver sees; the moment feels celebratory, not noisy; it never blocks the next action (a visible "See my package" button within 2 seconds); works on a phone |
| U-15 | Sender | Customize the link: change the name, try a taken name, set a title, switch the amount preview on and off, copy | The availability message is clear within a second; the preview card matches what a chat app shows; nothing needs explaining |
| U-14 | Sender, approvers | Create a part approved by 2 of 3 people (including yourself). Approve as two of them | The wording shows "1 of 2" then "2 of 2" correctly; each approver sees their own status; the receiver sees the same count |
| U-06 | Sender | Track the package as parts open and are taken | Statuses use only the agreed words; times are right in the viewer's timezone |
| U-07 | Sender | Send a package that nobody accepts; take it back after the deadline | Money returns; clear message |
| U-08 | Anyone | Check the claims on the landing page against the real app (gasless, one package with rules, approval, receiver sees before accepting, cross-chain) | Each claim is true or flagged; wording "gasless for everyone" is only kept if bootstrap top-up covers senders (decision D-P1 in `DECISIONS.md`) |
| U-09 | Anyone | Cross-chain: send mock USDC from Base Sepolia to Andum and back to Sepolia | Arrives; progress visible; labelled as a demo bridge |
| U-10 | Anyone | Try to break it (spam clicks, wrong link, expired link, refresh mid-flow, other person's link) | No lost money, no stuck screen; defects filed |
| U-11 | Anyone | Read the README and run the quick start on a clean machine | Under 30 minutes (N-02) |
| U-12 | Judge's view | Follow only the 90-second demo script in the README | Works the first time |

### 11.3 Sign-off sheet

```
UAT run:   date ______  environment ______  build/commit ______
Tester:    ______________________
U-01 [ ] pass  [ ] fail   notes ______
U-02 [ ] pass  [ ] fail   notes ______
...
U-12 [ ] pass  [ ] fail   notes ______
Open defects S1: ___  S2: ___  S3: ___  S4: ___
Decision:  [ ] release candidate   [ ] fix and re-run
Signature: ______________________
```

---

## 12. Security and invariant tests

### 12.1 Invariants (property tests, WS-A)

Generate random sequences (at least 10,000) of calls by random accounts: `create_package`, `ft_transfer_call` (right and wrong amounts and tokens), `accept_package`, `approve_part`, `claim` (including parallel), `reclaim_unaccepted`, time advances, token failure switches. After every step check:

| ID | Invariant | Check |
|---|---|---|
| INV-01 | I-1 | No call by admin or relayer changes token balances held for packages |
| INV-02 | I-2 | Per part: taken + refunded <= funded <= amount |
| INV-03 | I-3 | Each part's payout count <= 1 (count `part_claimed` events) |
| INV-04 | I-4 | Core's token balance equals the sum over packages of funded minus taken minus reclaimed (per token) |
| INV-05 | I-5 | Terms read after every step equal terms at creation |
| INV-06 | I-6 | One NFT per accepted package, owner equals `owner`; none for others |
| INV-07 | I-7 | Every token in any package is on the allowlist at creation time |
| INV-08 | Safety | A non-owner never receives tokens from `claim` |
| INV-09 | Liveness | A part with all conditions met and no pending transfer can always be taken (no stuck state) |
| INV-10 | I-8 | Bridge: each source nonce executes at most once (B and E contracts) |

### 12.2 Manual security checklist (WS-F, mark each)

| ID | Check |
|---|---|
| SEC-01 | Reentrancy: callbacks cannot be used to claim twice (covered by C-CLAIM-30..32) |
| SEC-02 | No contract method exists that sends funds to an account chosen by the sender, approver or admin |
| SEC-03 | Panics cannot leave an inconsistent state (state changes only in callbacks for transfers) |
| SEC-04 | The relayer cannot be used to pay for arbitrary calls (policy fuzz, A-RELAY-EX-01) |
| SEC-05 | Relayer key holds only gas funds; rotation procedure in `RUNBOOK.md` works |
| SEC-06 | Invite secret never logged, never returned to anyone who has not passed the email check; stored encrypted |
| SEC-07 | OTP: hashed storage, attempt limit, expiry, resend limit |
| SEC-08 | Invite secret exposure in the accept transaction is documented in README (known) |
| SEC-09 | Session cookies: httpOnly, SameSite, secure in staging; CSRF protection on state-changing routes |
| SEC-10 | Rate limits present on faucet, bootstrap, OTP, relay |
| SEC-11 | SQL injection and XSS probes on every input (note, email, ids). Note and names are escaped in the UI and in the NFT SVG |
| SEC-12 | Dependency audit (`cargo audit`, `npm audit`, Slither or `forge` static checks on Solidity) with no high findings left unexplained |
| SEC-13 | `.env` and keys absent from the repository and from git history (run a secret scanner) |
| SEC-14 | Mock bridge and mock tokens are labelled as demo in the UI, API docs and README |
| SEC-15 | Phishing-style invite links: the link shows the sender's account and what is inside before any action |
| SEC-16 | Admin upgrade key is documented as a trust point |
| SEC-17 | The note is public on chain: the UI says so before sending, and it is not presented as private. No personal data is placed in the NFT image |
| SEC-19 | Link names cannot be used to impersonate (no `andum*`, `admin`, `support`-style names in the reserved list) and the sender's display name is shown on the link page |
| SEC-20 | Chat preview leaks nothing: no email, no amount unless chosen, no note |
| SEC-18 | A receiver can never approve their own package (C-APPROVE-17) and a threshold can never be lowered after creation (I-5) |

---

## 13. Non-functional tests

| ID | Pri | Test | Target |
|---|---|---|---|
| NF-01 | P0 | N-01 gasless audit: across E2E-01, sum of NEAR balance changes of alice, rina, budi | Each decreases by at most a few yoctoNEAR (only 1 yocto per funding transfer); top-up is credited, never debited |
| NF-02 | P1 | Relay latency: submit to `SUCCEEDED` | Median under 8 s on testnet |
| NF-03 | P1 | Read latency: `GET /packages/{id}` cached, uncached | Under 300 ms, under 2 s |
| NF-04 | P1 | Load: 20 concurrent users create and take packages for 5 minutes | No lost jobs, no duplicate payouts, error rate under 2% |
| NF-05 | P1 | Relayer daily budget consumption for one E2E-01 run | Recorded; extrapolate and confirm the budget lasts through judging |
| NF-06 | P1 | Storage: 100 packages created; `storage_report` | Balance drop matches estimate within 20%; record per-package cost |
| NF-07 | P1 | Recovery: restart each process while idle and while busy | No data loss; no duplicate emails or payouts |
| NF-08 | P1 | Browser matrix: latest Chrome, Safari (iOS), Firefox | E2E-01 UI steps pass |
| NF-09 | P1 | Accessibility: keyboard use of the main flows, contrast, reduced-motion respected | No blockers |
| NF-10 | P0 | Clean install: follow README from an empty machine | Under 30 minutes (N-02) |
| NF-11 | P1 | Public RPC outage drill: switch to the second RPC | Backend recovers without restart |

---

## 14. Defect handling

Severity:

| Sev | Meaning | Example |
|---|---|---|
| S1 | Funds lost, stuck or taken by the wrong party; invariant broken | Double payout |
| S2 | A P0 flow cannot be completed | Receiver cannot accept |
| S3 | A flow works with a workaround, or P1 is broken | Email delayed |
| S4 | Cosmetic or copy | Wrong status word |

Defect template (put in `docs/defects/<id>.md` or the issue tracker):

```
ID:            D-<number>
Severity:      S1..S4
Test ID:       e.g. C-CLAIM-30
Environment:   sandbox | local-stack | testnet, commit hash
Steps:         1. ... 2. ...
Expected:
Actual:        (include error code, tx hash or log lines)
Evidence:      screenshot, video, explorer link
Suspected area: WS-A | WS-B | WS-C | WS-D | WS-E
Status:        open | fixed in <commit> | verified by <tester> | won't fix (reason)
```

Rules: S1 and S2 stop the release. A fix needs a regression test with the defect id in its name. QA re-runs the full affected suite, not only the failing case.

---

## 15. Reporting

At every human gate (H-3, H-4, H-5) WS-F produces `docs/TEST-REPORT.md` with: build and commit, environment and contract addresses, table of every test ID with pass, fail, skipped (with reason), links to videos and explorer transactions for E2E, the invariant run seeds and counts, open defects by severity, and the list of known limitations (including C-APPROVE-90, the trusted mock bridge, the public invite secret in the accept transaction, and the admin upgrade key).

## 16. Traceability (requirement to tests)

| Requirement | Tests |
|---|---|
| C-01, C-03 | C-CREATE-*, C-FUND-02 |
| C-02 | C-FUND-* |
| C-04 | C-ACCEPT-*, A-INV-14 |
| C-05 | C-APPROVE-*, E2E-13 |
| L-01 | A-LINK-*, E2E-15, U-15, SEC-19, SEC-20 |
| C-12 | C-CREATE-27, C-CREATE-28, C-NFT-05, E2E-14 |
| O-01 | E2E-14, U-13 |
| C-06 | C-CLAIM-*, INV-03, E2E-04 |
| C-07 | C-RECLAIM-*, E2E-02 |
| C-08 | C-NFT-* |
| C-09 | C-EVENT-*, A-REC-01 |
| C-10 | C-ADMIN-*, INV-01 |
| C-11 | C-VIEW-* |
| F-01, F-02 | F-* |
| B-01 | B-IN-*, B-OUT-* |
| E-01, E-02, E-03 | E-FAUCET-*, E-TOKEN-*, E-GW-*, E-FWD-* |
| A-01, A-02 | A-AUTH-*, A-BOOT-* |
| A-03 | A-INV-* |
| A-04 | A-RELAY-* |
| A-05 | A-PKG-* |
| A-06 | A-NOT-* |
| A-07 | A-FAU-* |
| A-08 | A-BRIDGE-* |
| A-09 | A-API-04 |
| U-01, U-02 | E2E-01, E2E-09, UAT U-01..U-12 |
| N-01 | A-RELAY-INT-01/02, NF-01 |
| N-02 | NF-10, U-11 |
