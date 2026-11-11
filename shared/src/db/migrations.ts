/** SQL migrations (ANDUM-PLAN 7.2 plus the support tables the API needs). Applied in order, once. */
export const MIGRATIONS: { id: string; sql: string }[] = [
  {
    id: '001_init',
    sql: `
create extension if not exists citext;
create extension if not exists pgcrypto;

create table users (
  id uuid primary key default gen_random_uuid(),
  auth_provider text not null, auth_subject text not null,
  email citext, near_account_id text not null unique, public_key text not null,
  created_at timestamptz not null default now(),
  unique (auth_provider, auth_subject)
);
create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null, created_at timestamptz not null default now()
);
create table login_nonces (
  nonce text primary key, created_at timestamptz not null default now(), used_at timestamptz
);
create table invites (
  id text primary key,
  sender_account text not null,
  recipient_email citext not null,
  secret_hash bytea not null,
  secret_enc bytea not null,
  package_id bigint,
  accept_by timestamptz,
  status text not null default 'DRAFT',
  attach_tx text,
  slug citext unique,
  link_title text,
  show_amount boolean not null default false,
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
create table packages (
  id bigint primary key, sender text not null, owner text, status text not null,
  accept_by_ns numeric not null, view jsonb not null,
  updated_at timestamptz not null default now(), chain_block bigint
);
create index on packages (sender);
create index on packages (owner);
create table parts (
  package_id bigint references packages(id) on delete cascade, part_id int,
  token text not null, amount numeric not null, unlock_ns numeric,
  approvers text[] not null default '{}', threshold int not null default 1,
  approvals text[] not null default '{}', approved boolean not null default false,
  state text not null, status text not null default '', taken_ns numeric,
  primary key (package_id, part_id)
);
create index on parts (unlock_ns) where state = 'LOCKED';
create index parts_approvers_idx on parts using gin (approvers);
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
  status text not null default 'QUEUED',
  tx_hash text, error_code text, error_message text, outcome jsonb,
  attempts int not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (account_id, client_request_id), unique (payload_hash)
);
create table notifications (
  id uuid primary key default gen_random_uuid(),
  kind text not null, dedupe_key text not null unique,
  to_email citext not null, status text not null default 'PENDING',
  payload jsonb not null default '{}'::jsonb, attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  provider_id text, error text, created_at timestamptz not null default now(), sent_at timestamptz
);
create table notification_prefs (
  account_id text primary key, email_enabled boolean not null default true, email citext
);
create table faucet_claims (
  id bigserial primary key, chain text not null, asset_id text not null,
  recipient text not null, amount numeric not null, ip text, tx_hash text,
  created_at timestamptz not null default now()
);
create index on faucet_claims (recipient, asset_id, created_at);
create table bridge_transfers (
  id uuid primary key default gen_random_uuid(),
  direction text not null, evm_chain text not null, asset_id text not null, amount numeric not null,
  evm_address text not null, near_account text not null,
  src_nonce numeric not null, src_tx text not null, dst_tx text,
  fund_package_id bigint, fund_part_id int,
  status text not null default 'DETECTED', error text, confirmations int not null default 0,
  block_number bigint,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (evm_chain, direction, src_nonce)
);
create table quota_usage (
  account_id text, bucket text, window_start timestamptz, used int not null default 0,
  primary key (account_id, bucket, window_start)
);
create table kill_switches (key text primary key, enabled boolean not null default false);
insert into kill_switches (key) values ('relayer'), ('faucet'), ('bridge');
create table idempotency_keys (
  scope text not null, key text not null, body_hash text not null,
  status int not null, response jsonb, created_at timestamptz not null default now(),
  primary key (scope, key)
);
create table topups (
  id bigserial primary key, account_id text not null, yocto numeric not null, tx_hash text,
  created_at timestamptz not null default now()
);
create index on topups (account_id, created_at);
create table worker_state (key text primary key, value text not null);
`,
  },
  {
    id: '002_email_auth',
    sql: `
alter table users alter column near_account_id drop not null;
alter table users alter column public_key drop not null;
alter table users add column email_verified_at timestamptz;
alter table sessions add column auth_method text not null default 'key';
create table login_otps (
  id uuid primary key default gen_random_uuid(),
  email citext not null, code_hash bytea not null, attempts int not null default 0,
  expires_at timestamptz not null, used_at timestamptz, ip text,
  created_at timestamptz not null default now()
);
create index on login_otps (email, created_at desc);
create table key_backups (
  user_id uuid primary key references users(id) on delete cascade,
  blob jsonb not null, updated_at timestamptz not null default now()
);
`,
  },
];
