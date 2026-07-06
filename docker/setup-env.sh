#!/usr/bin/env bash
set -euo pipefail

# Usage: docker/setup-env.sh [env-name] [--reset]
#
# Provisions the bind-mount source directories for a named test environment
# under docker/environments/<env-name>/runtime/{registry,local}/{workspace,data},
# so `docker compose up` has something real to mount. Must run before
# `docker compose up` — Compose can auto-create empty bind-mount dirs but
# can't seed content into them.
#
# Safe to re-run: a project directory that already exists is left alone
# (the container's own bootstrap handles per-file idempotency from there).
# --reset wipes and reseeds both modes for the given environment.

ENV_NAME="default"
RESET=0

for arg in "$@"; do
  case "$arg" in
    --reset) RESET=1 ;;
    -*) echo "Usage: $0 [env-name] [--reset]" >&2; exit 1 ;;
    *)  ENV_NAME="$arg" ;;
  esac
done

cd "$(dirname "$0")/.."

# Ensure AGENT_ADAPTERS_DIR/AGENT_CHAT_DIR default to the sibling checkouts
# of the MAIN repo root (not this checkout's cwd), so `docker compose build
# app-local` resolves correctly from inside a git worktree too. Only
# appends if the key is absent — never overwrites a value already set.
MAIN_ROOT="$(cd "$(git rev-parse --git-common-dir)/.." && pwd)"
SIBLINGS_DIR="$(dirname "$MAIN_ROOT")"
ensure_env_default() {
  if [ -f .env ] && grep -q "^$1=" .env; then
    return
  fi
  # .env may exist without a trailing newline — appending blindly would
  # otherwise concatenate onto whatever key was last in the file.
  if [ -s .env ] && [ -n "$(tail -c1 .env)" ]; then
    printf '\n' >> .env
  fi
  printf '%s=%s\n' "$1" "$2" >> .env
}
ensure_env_default AGENT_ADAPTERS_DIR "$SIBLINGS_DIR/agent-adapters"
ensure_env_default AGENT_CHAT_DIR "$SIBLINGS_DIR/agent-chat"

ENV_DIR="docker/environments/$ENV_NAME"
SEED_PROJECT="$ENV_DIR/seed/project"

for MODE in registry local; do
  WORKSPACE_DIR="$ENV_DIR/runtime/$MODE/workspace"
  DATA_DIR="$ENV_DIR/runtime/$MODE/data"
  PROJECT_DIR="$WORKSPACE_DIR/project"

  if [ "$RESET" = "1" ]; then
    echo "[$MODE] --reset: wiping runtime state for env '$ENV_NAME'"
    rm -rf "$WORKSPACE_DIR" "$DATA_DIR"
  fi

  mkdir -p "$DATA_DIR"

  if [ -d "$PROJECT_DIR" ]; then
    echo "[$MODE] workspace/project already provisioned — leaving as-is"
  elif [ -d "$SEED_PROJECT" ]; then
    echo "[$MODE] seeding workspace/project from $SEED_PROJECT"
    mkdir -p "$WORKSPACE_DIR"
    cp -R "$SEED_PROJECT" "$PROJECT_DIR"
  else
    echo "[$MODE] no seed at $SEED_PROJECT — creating empty workspace/project"
    mkdir -p "$PROJECT_DIR"
  fi
done

echo "Environment '$ENV_NAME' ready."
if [ "$ENV_NAME" != "default" ]; then
  echo "Run with: C4S_ENV=$ENV_NAME docker compose up ..."
fi
