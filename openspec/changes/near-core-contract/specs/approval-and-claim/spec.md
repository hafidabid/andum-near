## ADDED Requirements

### Requirement: Approver group approval
Only named approvers SHALL approve a part, each at most once effectively; a part is approved when distinct approvals reach its threshold.

#### Scenario: Single approver
- **WHEN** the one approver calls `approve_part`
- **THEN** `part_approved` has `approvals=1, threshold=1, threshold_met=true`

#### Scenario: 2 of 3
- **WHEN** two distinct approvers approve
- **THEN** the first event has `threshold_met=false`, the second `true`

#### Scenario: Duplicate approval
- **WHEN** the same approver approves twice
- **THEN** the second call is a no-op with no event and no error

#### Scenario: Stranger or receiver approves
- **WHEN** an account not in the approver list calls it
- **THEN** it panics with `NOT_APPROVER`

#### Scenario: Approval before date and after threshold
- **WHEN** an approver approves before `unlock_ns`, or after the threshold is met
- **THEN** it is recorded; extra approvals change nothing

#### Scenario: Wrong package state
- **WHEN** the package is `AWAITING_FUNDS` or `RECLAIMED`
- **THEN** it panics with `PACKAGE_NOT_ACTIVE`

### Requirement: Claim (Take) a part
Only the NFT owner SHALL claim a part whose rules are met; state changes to `Taken` only in the callback.

#### Scenario: Open part without rules
- **WHEN** the owner claims a part with no unlock time and no approvers
- **THEN** state becomes `Pending{attempt_id}`, `claim_started` is emitted and a storage_deposit + ft_transfer + callback chain is issued

#### Scenario: Time not reached / approval missing
- **WHEN** `now < unlock_ns`, or threshold not met
- **THEN** `TIME_NOT_REACHED` or `APPROVAL_MISSING`; when both fail `TIME_NOT_REACHED` wins

#### Scenario: Not owner, not accepted
- **WHEN** caller is not the owner, or package not `ACCEPTED`
- **THEN** `NOT_PASS_OWNER` or `PACKAGE_NOT_ACTIVE`

#### Scenario: Double take and in-flight take
- **WHEN** the part is `Taken` or `Pending`
- **THEN** `ALREADY_TAKEN` or `TRANSFER_PENDING`

#### Scenario: Callback success
- **WHEN** `on_claim_resolved` runs with a matching attempt id and success
- **THEN** state is `Taken{now}` and `part_claimed` emitted; if all parts taken the sender's open count decreases

#### Scenario: Callback failure
- **WHEN** the transfer failed
- **THEN** state reverts to `Locked` and `claim_failed` is emitted so the owner can retry

#### Scenario: Stale callback
- **WHEN** the callback's attempt id differs from the current pending one, or the part is not pending
- **THEN** nothing changes

#### Scenario: Callback is private
- **WHEN** an external account calls `on_claim_resolved`
- **THEN** it is rejected
