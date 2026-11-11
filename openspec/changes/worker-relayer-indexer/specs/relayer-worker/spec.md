## ADDED Requirements

### Requirement: Submit and record
The relayer worker SHALL submit queued delegate actions and record each outcome.

#### Scenario: Success
- **WHEN** a queued job passes policy and the chain succeeds
- **THEN** job becomes `SUCCEEDED` with tx hash, events are stored and packages reconciled

#### Scenario: Contract failure is final
- **WHEN** the chain reports `ANDUM_ERR:TIME_NOT_REACHED`
- **THEN** job is `FAILED` with `error_code=TIME_NOT_REACHED` and is never retried

#### Scenario: Transport error retries
- **WHEN** submission throws a transport error
- **THEN** it is retried up to the limit then `FAILED` with `UPSTREAM_UNAVAILABLE`

#### Scenario: Policy re-check
- **WHEN** state changed (expired height, kill switch on)
- **THEN** the job is `REJECTED` and not submitted

#### Scenario: Idempotent worker
- **WHEN** the same job id is processed twice
- **THEN** the chain is called once
