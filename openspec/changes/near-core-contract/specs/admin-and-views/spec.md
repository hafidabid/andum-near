## ADDED Requirements

### Requirement: Computed part status
`get_package` SHALL compute each part's `status` and `reason` at query time per ANDUM-PLAN §5.7.

#### Scenario: Status table
- **WHEN** the package is accepted
- **THEN** parts show `OPEN`, `WAITING_DATE`, `WAITING_APPROVAL`, `WAITING_DATE_AND_APPROVAL`, `PROCESSING` or `TAKEN` with reasons `null`, `TIME_NOT_REACHED`, `APPROVAL_MISSING`, `TIME_NOT_REACHED`, null, null

#### Scenario: Not accepted
- **WHEN** the package is not `ACCEPTED`
- **THEN** every untaken part is `NOT_ACCEPTED` with reason `PACKAGE_NOT_ACTIVE`

#### Scenario: Missing package
- **WHEN** `get_package` has an unknown id
- **THEN** it returns null

#### Scenario: Paginated lists
- **WHEN** `get_packages_by_sender` or `get_packages_by_owner` is called with from/limit
- **THEN** results are ordered by id and bounded

### Requirement: Admin without custody
The owner SHALL be able to pause, change allowlist and limits, top up and migrate, and SHALL NOT have any method that moves user funds (I-1).

#### Scenario: Non-owner admin call
- **WHEN** a non-owner calls an admin method
- **THEN** it panics with `NOT_ADMIN`

#### Scenario: Pause blocks writes
- **WHEN** paused
- **THEN** create, accept and claim panic with `PAUSED` while views still work

#### Scenario: Storage reserve
- **WHEN** contract balance cannot cover new storage
- **THEN** create panics with `STORAGE_RESERVE_LOW`

#### Scenario: Events format
- **WHEN** any state change occurs
- **THEN** a log `EVENT_JSON:{"standard":"andum","version":"1.0.0","event":...,"data":[...]}` is emitted
