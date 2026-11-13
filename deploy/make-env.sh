#!/usr/bin/env bash
# Build deploy/.env.production from your local testnet secrets (deployments/secrets/live.env).
# Run on your laptop. Re-running keeps the generated secrets (DB password, session and invite keys)
# so the database and existing invites stay valid.
#
#   API_DOMAIN=andum-backend.projectdeadwood.my.id WEB_DOMAIN=andum.projectdeadwood.my.id \
#   SMTP_HOST=smtp.example.com SMTP_PORT=587 SMTP_USER=... SMTP_PASS=... EMAIL_FROM='Andum <no-reply@projectdeadwood.my.id>' \
#   deploy/make-env.sh
set -euo pipefail
cd "$(dirname "$0")/.."

API_DOMAIN="${API_DOMAIN:-andum-backend.projectdeadwood.my.id}"
WEB_DOMAIN="${WEB_DOMAIN:-andum.projectdeadwood.my.id}"
SRC="${SRC:-deployments/secrets/live.env}"
OUT="deploy/.env.production"
[ -f "$SRC" ] || { echo "missing $SRC (NEAR relayer / bridge keys live there)"; exit 1; }

prev() { [ -f "$OUT" ] && grep -E "^$1=" "$OUT" | tail -1 | cut -d= -f2- || true; }
PGPW="$(prev POSTGRES_PASSWORD)";   PGPW="${PGPW:-$(openssl rand -hex 24)}"
SESS="$(prev SESSION_SECRET)";      SESS="${SESS:-$(openssl rand -hex 32)}"
INV="$(prev INVITE_ENC_KEY)";       INV="${INV:-$(openssl rand -base64 32)}"

TMP="$(mktemp)"; trap 'rm -f "$TMP"' EXIT
{
  grep -vE '^\s*(#|$)' "$SRC"
  echo "NODE_ENV=production"
  echo "PORT=8080"
  echo "PUBLIC_API_BASE=https://$API_DOMAIN"
  echo "PUBLIC_WEB_BASE=https://$WEB_DOMAIN"
  echo "WEB_ORIGIN=https://$WEB_DOMAIN"
  echo "POSTGRES_PASSWORD=$PGPW"
  echo "DATABASE_URL=postgres://andum:$PGPW@postgres:5432/andum"
  echo "REDIS_URL=redis://redis:6379"
  echo "SESSION_SECRET=$SESS"
  echo "INVITE_ENC_KEY=$INV"
  echo "AUTH_LOCAL_ENABLED=false"
  echo "AUTH_EMAIL_ENABLED=true"
  if [ -n "${SMTP_HOST:-}" ]; then
    echo "EMAIL_PROVIDER=smtp"
    echo "EMAIL_FROM=\"${EMAIL_FROM:-Andum <no-reply@$WEB_DOMAIN>}\""
    echo "SMTP_HOST=$SMTP_HOST"
    echo "SMTP_PORT=${SMTP_PORT:-587}"
    echo "SMTP_SECURE=${SMTP_SECURE:-false}"
    echo "SMTP_USER=${SMTP_USER:-}"
    echo "SMTP_PASS=${SMTP_PASS:-}"
  else
    echo "EMAIL_PROVIDER=console"
    echo "WARNING: no SMTP_HOST given; sign-in codes will only appear in the worker/api logs" >&2
  fi
} | awk -F= '
  # last assignment of a key wins; drop SMTP_URL (local Mailpit) so it cannot shadow SMTP_HOST
  { k=$1; if (k=="SMTP_URL") next; if (!(k in v)) order[++n]=k; v[k]=substr($0, length(k)+2) }
  END { for (i=1;i<=n;i++) print order[i] "=" v[order[i]] }' > "$TMP"

install -m 600 "$TMP" "$OUT"
echo "wrote $OUT ($(wc -l < "$OUT") keys, mode 600). It is gitignored; never commit it."
