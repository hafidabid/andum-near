## ADDED Requirements

### Requirement: Create package validation
The contract SHALL validate `create_package` in the order defined by ANDUM-PLAN §5.2 and panic with `ANDUM_ERR:<CODE>` on the first failure.

#### Scenario: Valid package
- **WHEN** a sender creates a package with 1..8 allowlisted parts, positive amounts, future unlock times and a valid invite hash
- **THEN** a package id is returned, status is `AWAITING_FUNDS` and `package_created` is emitted

#### Scenario: Paused contract
- **WHEN** the contract is paused and any caller creates a package
- **THEN** it panics with `PAUSED`

#### Scenario: Part count bounds
- **WHEN** parts is empty or has 9 entries
- **THEN** it panics with `INVALID_PARTS`; 1 and 8 parts are accepted

#### Scenario: Token not allowlisted
- **WHEN** any part names a token outside the allowlist
- **THEN** it panics with `TOKEN_NOT_ALLOWED`

#### Scenario: Zero or unparsable amount
- **WHEN** a part amount is `0`
- **THEN** it panics with `INVALID_AMOUNT`

#### Scenario: Approvers without unlock time
- **WHEN** a part has approvers but no `unlock_ns`
- **THEN** it panics with `INVALID_RULE`

#### Scenario: Bad approver group
- **WHEN** approvers are empty-but-threshold-set, more than 5, duplicated, threshold 0 or above the count, or include the fixed recipient
- **THEN** it panics with `INVALID_APPROVERS`

#### Scenario: Unlock in the past or at now
- **WHEN** `unlock_ns <= now`
- **THEN** it panics with `UNLOCK_IN_PAST`

#### Scenario: Acceptance deadline window
- **WHEN** `accept_by_ns <= now` or `accept_by_ns > now + 90 days`
- **THEN** it panics with `INVALID_EXPIRY`; exactly `now + 90 days` is accepted

#### Scenario: Note and theme
- **WHEN** note exceeds 140 characters (multi-byte counted as characters, 140 exactly accepted) or theme is unknown
- **THEN** it panics with `NOTE_TOO_LONG` or `INVALID_THEME`

#### Scenario: Recipient xor invite hash
- **WHEN** both or neither of `recipient` and `invite_hash` are given
- **THEN** it panics with `INVALID_PARTS`

#### Scenario: Per-sender limit
- **WHEN** the sender already has `max_open_per_sender` unfinished packages
- **THEN** it panics with `LIMIT_EXCEEDED`

### Requirement: Exact funding
The contract SHALL accept funding only through `ft_on_transfer` from the part's token contract, from the package sender, with a well-formed message, and SHALL return any excess as unused.

#### Scenario: Exact funding of the only part
- **WHEN** the sender transfers exactly the part amount
- **THEN** unused is `0`, `part_funded` and `package_funded` are emitted and status becomes `FUNDED`

#### Scenario: Partial then complete funding
- **WHEN** funding arrives in two transfers
- **THEN** status stays `AWAITING_FUNDS` until the remainder arrives

#### Scenario: Over-funding
- **WHEN** the transfer exceeds the remaining amount
- **THEN** only the remainder is kept, the excess is returned as unused and `deposit_refunded` is emitted

#### Scenario: Wrong token, wrong sender, bad message, inactive package
- **WHEN** the predecessor is not the part token, or sender is not the package sender, or msg is malformed, or the package is not `AWAITING_FUNDS`
- **THEN** it panics with `WRONG_TOKEN`, `WRONG_SENDER`, `BAD_MSG`, `PACKAGE_NOT_ACTIVE` respectively

#### Scenario: Unknown package or part
- **WHEN** msg names a missing package or part
- **THEN** it panics with `PACKAGE_NOT_FOUND` or `PART_NOT_FOUND`

### Requirement: Accept package
The contract SHALL let the invited receiver accept a `FUNDED` package once, minting one non-transferable NFT to them.

#### Scenario: Accept with correct secret
- **WHEN** a caller supplies a secret whose sha256 matches `invite_hash` before `accept_by_ns`
- **THEN** owner is the caller, status `ACCEPTED`, NFT `token_id = package_id` minted, `package_accepted` emitted

#### Scenario: Accept as fixed recipient
- **WHEN** the package names a recipient and that account accepts without a secret
- **THEN** it succeeds; any other account gets `NOT_INVITED_ACCOUNT`

#### Scenario: Wrong secret, expiry, repeat, unfunded
- **WHEN** secret is wrong, deadline passed, package already accepted, or package not `FUNDED`
- **THEN** `INVITE_SECRET_INVALID`, `INVITE_EXPIRED`, `ALREADY_ACCEPTED`, `PACKAGE_NOT_ACTIVE`

#### Scenario: Receiver is an approver
- **WHEN** the accepting account is an approver of any part
- **THEN** it panics with `RECEIVER_IS_APPROVER`

### Requirement: Reclaim unaccepted package
The sender SHALL be able to take back funds of an unaccepted package, idempotently.

#### Scenario: Reclaim after deadline
- **WHEN** status is `FUNDED` and `now > accept_by_ns` and the sender calls `reclaim_unaccepted`
- **THEN** status is `RECLAIMED` and a `ft_transfer` of each funded amount is issued

#### Scenario: Reclaim awaiting funds
- **WHEN** status is `AWAITING_FUNDS`
- **THEN** reclaim is allowed immediately

#### Scenario: Not reclaimable
- **WHEN** package is accepted, or `FUNDED` before the deadline, or caller is not the sender
- **THEN** `NOT_RECLAIMABLE` or `NOT_SENDER`; a second reclaim with nothing left to return is `ALREADY_RECLAIMED`

#### Scenario: Failed refund transfer
- **WHEN** the refund callback reports failure
- **THEN** the part's `reclaimed` counter is rolled back so the sender can retry
