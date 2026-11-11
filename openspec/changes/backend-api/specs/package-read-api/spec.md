## ADDED Requirements

### Requirement: Package reads
The API SHALL serve package views from a chain-backed cache.

#### Scenario: List by role
- **WHEN** a user lists `role=sender|owner|approver`
- **THEN** only packages where they hold that role are returned, paginated by cursor

#### Scenario: Party-only detail
- **WHEN** a non-party requests a package
- **THEN** `403 FORBIDDEN`

#### Scenario: Stale cache refresh
- **WHEN** the cache row is older than 10s
- **THEN** the chain view is fetched and the cache updated

#### Scenario: NFT image
- **WHEN** `GET /packages/{id}/nft.svg` is read
- **THEN** a valid SVG reflecting theme is returned without a session and with escaped text

#### Scenario: Health
- **WHEN** `/healthz` or `/readyz` is called
- **THEN** liveness is 200; readiness is 503 if DB or Redis is down
