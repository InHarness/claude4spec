#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/workspace/project}"
PORT="${PORT:-3000}"
# 2.1.0: the Host/Origin guard admits only loopback names and the publicUrl
# host. A container reached by any other name (compose service, container IP,
# a proxy hostname) needs PUBLIC_URL set to that address.
PUBLIC_URL="${PUBLIC_URL:-}"

# 2.1.58 (M01 r7ozfsa9): the start selects a workspace and registers no
# project — `--cwd` names a workspace HOME, never a project directory. The
# registry workspace on --port (in $C4S_HOME) is started, and the fixture
# project is added the way the UI adds one: POST /api/workspace/projects
# (idempotent — safe against an already-provisioned volume on restart).
mkdir -p "$PROJECT_DIR"
node dist/bin/claude4spec.js \
  --mode prod \
  --port "$PORT" \
  --host 0.0.0.0 \
  ${PUBLIC_URL:+--public-url "$PUBLIC_URL"} \
  --no-open &
SERVER_PID=$!
# Forward a stop to the server and let it shut down before the container exits.
trap 'kill -TERM "$SERVER_PID" 2>/dev/null || true; wait "$SERVER_PID"; exit $?' TERM INT

# Poll for as long as the server process lives — no fixed deadline: a slow
# first boot keeps it alive, a crashed one ends the loop.
until PROJECT_DIR="$PROJECT_DIR" PORT="$PORT" node -e '
  fetch(`http://127.0.0.1:${process.env.PORT}/api/workspace/projects`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cwd: process.env.PROJECT_DIR }),
  })
    .then(async (res) => {
      if (res.ok) process.exit(0);
      console.error(`registering ${process.env.PROJECT_DIR} failed: ${res.status} ${await res.text()}`);
      process.exit(2);
    })
    .catch(() => process.exit(1));
' || { status=$?; [ "$status" -eq 2 ] && { kill -TERM "$SERVER_PID" 2>/dev/null || true; exit 1; }; false; }; do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    wait "$SERVER_PID"
    exit $?
  fi
  sleep 0.5
done

wait "$SERVER_PID"
