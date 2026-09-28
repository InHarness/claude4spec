#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/workspace/project}"
PORT="${PORT:-3000}"
# 2.1.0: the Host/Origin guard admits only loopback names and the publicUrl
# host. A container reached by any other name (compose service, container IP,
# a proxy hostname) needs PUBLIC_URL set to that address.
PUBLIC_URL="${PUBLIC_URL:-}"

# bootstrapProject() is idempotent (src/server/workspace/bootstrap.ts) — safe
# to run --create-project against an already-provisioned volume on restart.
mkdir -p "$PROJECT_DIR"
exec node dist/bin/claude4spec.js \
  --cwd "$PROJECT_DIR" \
  --create-project \
  --mode prod \
  --port "$PORT" \
  --host 0.0.0.0 \
  ${PUBLIC_URL:+--public-url "$PUBLIC_URL"} \
  --no-open
