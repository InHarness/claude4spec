#!/usr/bin/env bash
set -euo pipefail

# Usage: docker/setup-plugin-env.sh <env-name> --entity-type=<type>[,<type>...] [--reset]
#
# Wraps docker/setup-env.sh for the Docker plugin smoke-test flow (see
# c4s-plugin-scaffold's docker/plugin-smoke.sh, the only intended caller):
#   1. Delegates provisioning of docker/environments/<env>/... to setup-env.sh.
#   2. Idempotently widens the seeded/runtime project's .claude4spec/config.json
#      `entities` whitelist to include the plugin's contributed type(s) — a
#      no-op when the key is absent (absent = all types already active, see
#      src/server/config.ts's doc comment on `entities`).
#   3. Sets trustProjectPlugins=true for the project BEFORE any container
#      starts, via `c4s trust-plugins` run directly against the runtime data
#      dir docker-compose.yml mounts as /data — see
#      src/bin/c4s/commands/trust-plugins.ts. Running this OUTSIDE the
#      container, before `docker compose up`, means the server's own
#      boot-time registerProject() finds trust already persisted, with no
#      dependency on whether a live server would pick up a late trust flip.
#
# Must run BEFORE:
#   docker compose -f docker-compose.yml -f docker-compose.plugin.yml up -d app-registry

ENV_NAME=""
RESET=0
ENTITY_TYPES=""

for arg in "$@"; do
  case "$arg" in
    --reset) RESET=1 ;;
    --entity-type=*) ENTITY_TYPES="${arg#--entity-type=}" ;;
    -*) echo "Usage: $0 <env-name> --entity-type=<type>[,<type>...] [--reset]" >&2; exit 1 ;;
    *) ENV_NAME="$arg" ;;
  esac
done

if [ -z "$ENV_NAME" ]; then echo "env-name required" >&2; exit 1; fi
if [ -z "$ENTITY_TYPES" ]; then echo "--entity-type=<type>[,<type>...] required" >&2; exit 1; fi

cd "$(dirname "$0")/.."
REPO_ROOT="$(pwd)"

CLI="$REPO_ROOT/dist/bin/c4s.js"
if [ ! -f "$CLI" ]; then
  echo "ERROR: $CLI not found — run 'npm run build:server' in this host checkout first" >&2
  exit 1
fi

if [ "$RESET" = "1" ]; then
  docker/setup-env.sh "$ENV_NAME" --reset
else
  docker/setup-env.sh "$ENV_NAME"
fi

ENV_DIR="$REPO_ROOT/docker/environments/$ENV_NAME"
SEED_CONFIG="$ENV_DIR/seed/project/.claude4spec/config.json"

patch_config() {
  local config_file="$1"
  node -e '
    const fs = require("fs");
    const path = require("path");
    const configPath = process.argv[1];
    const types = process.argv[2].split(",");
    let cfg = {};
    if (fs.existsSync(configPath)) cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
    if (Array.isArray(cfg.entities)) {
      const merged = new Set([...cfg.entities, ...types]);
      cfg.entities = [...merged];
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2) + "\n");
      console.log(`[setup-plugin-env] appended [${types.join(", ")}] to entities whitelist in ${configPath}`);
    } else {
      console.log(`[setup-plugin-env] ${configPath}: no explicit "entities" whitelist (absent = all types already active) — leaving untouched`);
    }
  ' "$config_file" "$ENTITY_TYPES"
}

for MODE in registry local; do
  RUNTIME_PROJECT="$ENV_DIR/runtime/$MODE/workspace/project"
  if [ -d "$RUNTIME_PROJECT" ]; then
    patch_config "$RUNTIME_PROJECT/.claude4spec/config.json"
  fi
done
if [ -f "$SEED_CONFIG" ]; then
  patch_config "$SEED_CONFIG"
fi

# Trust, before any container starts. --port/--mode must match
# docker/entrypoint.sh's own `--port "$PORT"` (always 3000 INSIDE the
# container regardless of PORT_HOST — see docker-compose.yml's port mapping)
# and `--mode prod`, so `c4s trust-plugins` resolves the exact same workspace
# the server's own `registry.selectOrCreate({ port, mode })` will resolve at
# boot. Done for both modes so `app-local` works too.
for MODE in registry local; do
  DATA_DIR="$ENV_DIR/runtime/$MODE/data"
  mkdir -p "$DATA_DIR"
  C4S_HOME="$DATA_DIR" node "$CLI" trust-plugins --cwd /workspace/project --port 3000 --mode prod true
done

echo "Plugin smoke-test env '$ENV_NAME' ready — trusted, entity types: $ENTITY_TYPES"
echo "Run with: PLUGIN_ROOT=<path> PLUGIN_MOUNT_NAME=<name> C4S_ENV=$ENV_NAME PORT_HOST=<port> \\"
echo "  docker compose -f docker-compose.yml -f docker-compose.plugin.yml up -d app-registry"
