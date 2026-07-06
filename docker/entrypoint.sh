#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/workspace/project}"
PORT="${PORT:-3000}"

# bootstrapProject() is idempotent (src/server/workspace/bootstrap.ts) — safe
# to run --create-project against an already-provisioned volume on restart.
mkdir -p "$PROJECT_DIR"
exec node dist/bin/claude4spec.js \
  --cwd "$PROJECT_DIR" \
  --create-project \
  --mode prod \
  --port "$PORT" \
  --no-open
