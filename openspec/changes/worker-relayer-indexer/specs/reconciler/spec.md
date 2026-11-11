## ADDED Requirements

### Requirement: Event and view sync
The reconciler SHALL mirror chain events and package views into Postgres idempotently.

#### Scenario: Parse logs
- **WHEN** outcome logs contain `EVENT_JSON:` lines of standard andum
- **THEN** they are stored once per (tx, log index); malformed or foreign standards are ignored

#### Scenario: Refresh cache
- **WHEN** a package id is mentioned by events or is active
- **THEN** its view is fetched and upserted to `packages` and `parts`

#### Scenario: Periodic sweep
- **WHEN** the interval fires
- **THEN** only non-final packages touched recently are refreshed in batches

#### Scenario: Chain failure
- **WHEN** a view call fails
- **THEN** the cache is unchanged and the next tick retries
