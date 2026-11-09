#!/usr/bin/env bash
set -euo pipefail

# 2.1.63 (M01 `uxlvmu4n`): the image's only way to start. An external tool
# configures the start through the environment contract below and never
# overrides this entrypoint. The contract (M01 `mcdkzcb6`) is a stable
# interface of the image (`f2ob9gtq`): a variable may be added, never removed
# or given a new meaning without a release entry.
#
#   PORT            --port <value>          unset/empty: --port 3000
#   PUBLIC_URL      --public-url <value>    unset/empty: flag not passed
#   REMOTE_API_URL  --remote-url <value>    unset/empty: flag not passed
#   PROJECT_DIR     directory registered    unset/empty: /workspace/project
#                   as a workspace project
#   PROJECT_TYPE    project-type slug       unset/empty: no type passed — a
#                   for the registration    directory with config.json keeps its
#                   of PROJECT_DIR          type, one without becomes `spec`
#
# An empty value means the same as an unset one, for every variable. For
# PUBLIC_URL and REMOTE_API_URL the flag is then NOT passed — never passed
# empty: `--public-url=` has its own meaning (restore the default), and an
# absent flag leaves the value its owner settles (`config.remoteApiUrl`, then
# the production address). The flags' semantics and validation belong to
# M31 / M24, not to this script. `--mode` is internal and gets no variable.
#
# ASSUMPTION:dev-0002 — extra container arguments (`$@`) are not forwarded to
# the server, and a registration refused with a 4xx ends the container.

PROJECT_DIR="${PROJECT_DIR:-/workspace/project}"
PORT="${PORT:-3000}"
PUBLIC_URL="${PUBLIC_URL:-}"
REMOTE_API_URL="${REMOTE_API_URL:-}"
PROJECT_TYPE="${PROJECT_TYPE:-}"

# The same process start as the CLI (M01 `r7ozfsa9`), without the workspace
# selectors (`--cwd`, `--workspace`): the registry workspace on --port (in
# $C4S_HOME) is started, listening on every interface, in `prod`, with no
# browser. The start registers no project; the project directory is added
# below the way the UI adds one.
mkdir -p "$PROJECT_DIR"
node dist/bin/claude4spec.js \
  --mode prod \
  --port "$PORT" \
  --host 0.0.0.0 \
  ${PUBLIC_URL:+--public-url "$PUBLIC_URL"} \
  ${REMOTE_API_URL:+--remote-url "$REMOTE_API_URL"} \
  --no-open &
SERVER_PID=$!
# Forward a stop to the server and let it shut down before the container exits.
trap 'kill -TERM "$SERVER_PID" 2>/dev/null || true; wait "$SERVER_PID"; exit $?' TERM INT

# Register PROJECT_DIR as a workspace project: POST /api/workspace/projects
# (M31 `zovs1ohc`), retried until it succeeds — also while the server does not
# listen yet, so the start and the registration need no synchronisation. The
# registration is idempotent, which makes every retry (and a restart on an
# already-provisioned volume) safe. No fixed deadline: the loop lasts as long
# as the server process lives. A 5xx is retried like a refused connection; a
# 4xx is the server refusing the directory itself, which no retry changes.
#
# 2.1.77 (M01 `mcdkzcb6`, M31 `m31boot01`): the registration path follows the
# directory. Without `.claude4spec/config.json` it is the new-project path, with
# PROJECT_TYPE (empty: `spec` — a directory without a config becomes a
# Specification). With one it is the existing-directory path: the project keeps
# the type in its file, so a restart with the same PROJECT_TYPE changes nothing;
# a PROJECT_TYPE that differs from the file's type (no key = `spec`) is the
# refusal PROJECT_TYPE_CONFLICT, before anything is sent. An unknown slug is
# refused by the server (PROJECT_TYPE_UNKNOWN). ASSUMPTION:dev-0772.
until PROJECT_DIR="$PROJECT_DIR" PORT="$PORT" PROJECT_TYPE="$PROJECT_TYPE" node -e '
  const fs = require("node:fs");
  const path = require("node:path");
  const dir = process.env.PROJECT_DIR;
  const wanted = process.env.PROJECT_TYPE || "";
  const configFile = path.join(dir, ".claude4spec", "config.json");
  const body = { cwd: dir };
  if (fs.existsSync(configFile)) {
    let fileType = "spec";
    try {
      const raw = JSON.parse(fs.readFileSync(configFile, "utf8"));
      if (raw && typeof raw.projectType === "string") fileType = raw.projectType;
    } catch {}
    if (wanted !== "" && wanted !== fileType) {
      console.error(`registering ${dir} failed: PROJECT_TYPE_CONFLICT — PROJECT_TYPE "${wanted}" differs from the type "${fileType}" in its config.json`);
      process.exit(2);
    }
  } else {
    body.projectType = wanted !== "" ? wanted : "spec";
  }
  fetch(`http://127.0.0.1:${process.env.PORT}/api/workspace/projects`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
    .then(async (res) => {
      if (res.ok) process.exit(0);
      console.error(`registering ${process.env.PROJECT_DIR} failed: ${res.status} ${await res.text()}`);
      process.exit(res.status >= 500 ? 1 : 2);
    })
    .catch(() => process.exit(1));
' || { status=$?; [ "$status" -eq 2 ] && { kill -TERM "$SERVER_PID" 2>/dev/null || true; wait "$SERVER_PID" 2>/dev/null || true; exit 1; }; false; }; do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    wait "$SERVER_PID"
    exit $?
  fi
  sleep 0.5
done

wait "$SERVER_PID"
