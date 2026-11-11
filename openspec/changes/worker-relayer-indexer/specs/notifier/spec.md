## ADDED Requirements

### Requirement: Part-ready email once
The notifier SHALL email the receiver once when a part opens, after re-checking the chain.

#### Scenario: Opened part
- **WHEN** an accepted package's part reached its date and approval
- **THEN** after a chain re-check one email is sent and recorded `SENT`

#### Scenario: Not actually open on chain
- **WHEN** the cache says open but the chain says otherwise
- **THEN** no email is sent

#### Scenario: No duplicates
- **WHEN** the notifier runs repeatedly or concurrently
- **THEN** at most one `part_ready` per part

#### Scenario: Opt out and failures
- **WHEN** the recipient disabled email, or the mailer fails
- **THEN** `SKIPPED`, or retry with backoff up to 5 times then `FAILED`

#### Scenario: Approval request
- **WHEN** a package is accepted
- **THEN** each named approver gets one `approval_request` email
