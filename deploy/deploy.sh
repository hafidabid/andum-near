#!/usr/bin/env bash
# Deploy / redeploy from your laptop. Needs ssh access, and rsync + docker on the server.
#
#   deploy/deploy.sh              sync code, rebuild, restart (first deploy and every redeploy)
#   deploy/deploy.sh env          also push deploy/.env.production (after running make-env.sh)
#   deploy/deploy.sh status|logs [service]|restart|down|backup|rollback
#
# Config: env vars or deploy/deploy.conf (gitignored), e.g.
#   SERVER=deploy@1.2.3.4
#   REMOTE_DIR=andum            # relative to the remote home
#   COMPOSE_FILE=deploy/docker-compose.shared.yml   # backend only, reuse the server's Postgres and Redis
#   API_DOMAIN=andum-backend.projectdeadwood.my.id
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f deploy/deploy.conf ] && . deploy/deploy.conf
: "${SERVER:?set SERVER=user@host (env or deploy/deploy.conf)}"
REMOTE_DIR="${REMOTE_DIR:-andum}"
API_DOMAIN="${API_DOMAIN:-andum-backend.projectdeadwood.my.id}"
API_PORT="${API_HOST_PORT:-8090}"
COMPOSE_FILE="${COMPOSE_FILE:-deploy/docker-compose.prod.yml}"
DC="docker compose --env-file deploy/.env.production -f $COMPOSE_FILE"
remote() { ssh -o ServerAliveInterval=30 "$SERVER" "cd $REMOTE_DIR && $*"; }

sync_code() {
  ssh "$SERVER" "mkdir -p $REMOTE_DIR/deploy"
  rsync -az --delete --human-readable \
    --include='/package.json' --include='/package-lock.json' --include='/Dockerfile' --include='/.dockerignore' \
    --include='/shared/***' --include='/backend/***' --include='/worker/***' \
    --include='/deploy/' --include='/deploy/docker-compose.prod.yml' --include='/deploy/docker-compose.shared.yml' \
    --exclude='node_modules' --exclude='dist' --exclude='*' \
    ./ "$SERVER:$REMOTE_DIR/"
}
push_env() {
  [ -f deploy/.env.production ] || { echo "run deploy/make-env.sh first"; exit 1; }
  # created with umask 077 so it is never readable by others, not even briefly (macOS rsync has no --chmod)
  ssh "$SERVER" "umask 077; cat > $REMOTE_DIR/deploy/.env.production" < deploy/.env.production
}
wait_healthy() {
  echo "waiting for the API..."
  for i in $(seq 1 30); do
    if remote "curl -fsS http://127.0.0.1:$API_PORT/healthz" >/dev/null 2>&1; then echo "API healthy"; return 0; fi
    sleep 3
  done
  echo "API did not become healthy; recent logs:"; remote "$DC logs --tail 60 api worker"; return 1
}

cmd="${1:-up}"; shift || true
case "$cmd" in
  up|env)
    [ "$cmd" = env ] && { ssh "$SERVER" "mkdir -p $REMOTE_DIR/deploy"; push_env; }
    remote "test -f deploy/.env.production" || { echo "no env on the server yet: run 'deploy/deploy.sh env'"; exit 1; }
    # remember what is running so 'rollback' can restore it
    remote "docker tag andum-api:latest andum-api:previous 2>/dev/null; docker tag andum-worker:latest andum-worker:previous 2>/dev/null; true"
    sync_code
    remote "$DC up -d --build --remove-orphans"
    wait_healthy
    remote "$DC ps"
    echo "public check:"; curl -fsS "https://$API_DOMAIN/healthz" && echo || echo "(https not up yet? run deploy/setup-server.sh on the server once)"
    remote "docker image prune -f >/dev/null"
    ;;
  status)   remote "$DC ps" ;;
  logs)     remote "$DC logs -f --tail 100 ${*:-api worker}" ;;
  restart)  remote "$DC restart ${*:-api worker}" ;;
  down)     remote "$DC down" ;;   # volumes (database) are kept
  backup)
    case "$COMPOSE_FILE" in *shared*) echo "shared-infra mode has no postgres service here: dump the 'andum' database from the existing Postgres instead"; exit 1;; esac
    f="andum-$(date +%Y%m%d-%H%M%S).sql.gz"
    remote "mkdir -p backups && $DC exec -T postgres pg_dump -U andum andum | gzip > backups/$f"
    scp -q "$SERVER:$REMOTE_DIR/backups/$f" "./$f" && echo "saved ./$f (also on the server in $REMOTE_DIR/backups)"
    ;;
  rollback)
    # Re-run the previous images without rebuilding. The database schema is additive, so this is safe for code-only regressions.
    remote "docker tag andum-api:previous andum-api:latest && docker tag andum-worker:previous andum-worker:latest && $DC up -d --no-build"
    wait_healthy
    ;;
  *) echo "unknown command: $cmd"; sed -n 2,9p "$0"; exit 1 ;;
esac
