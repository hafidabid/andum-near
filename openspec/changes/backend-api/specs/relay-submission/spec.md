## ADDED Requirements

### Requirement: Policy-checked relay
The API SHALL accept a signed delegate action only if every policy rule R1-R11 passes, then queue it.

#### Scenario: Allowed call
- **WHEN** an allowlisted single FunctionCall with correct deposit, gas, args and a fresh nonce is submitted
- **THEN** `202 {relay_id, status: QUEUED}`

#### Scenario: Denials
- **WHEN** identity mismatch, bad signature, expired/too-far block height, stale nonce, disallowed receiver/method, multiple or non-call actions, wrong deposit, excess gas, bad args, quota exceeded, duplicate payload, or relayer paused
- **THEN** `RELAY_POLICY_DENIED` naming the rule (`R1`..`R11`) or `RELAY_DUPLICATE`/`RATE_LIMITED`

#### Scenario: Idempotent submit
- **WHEN** the same `Idempotency-Key` and body is sent twice
- **THEN** the original response is replayed; a different body with the same key is `409 IDEMPOTENCY_CONFLICT`

#### Scenario: Status
- **WHEN** the owner polls `GET /relay/{id}`
- **THEN** status, tx hash, mapped `ANDUM_ERR` code are returned; others get `404`
