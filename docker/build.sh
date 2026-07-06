#!/usr/bin/env bash
set -euo pipefail

# Usage: docker/build.sh [registry|local]
#   registry (default) — @inharness-ai/agent-adapters and @inharness-ai/agent-chat
#     come from npm, matching a real release.
#   local — those two packages come from the sibling checkouts next to this
#     repo (../agent-adapters, ../agent-chat), to test proposed/uncommitted
#     changes to the agent runtime.

MODE="${1:-registry}"
cd "$(dirname "$0")/.."

if [ "$MODE" = "local" ]; then
  # Resolve siblings relative to the MAIN repo root (not the cwd), so this
  # works unchanged from inside a git worktree (e.g. .claude4spec-brief
  # worktrees under .worktrees/) where "../" would otherwise land inside
  # .worktrees/ instead of next to the real checkout.
  MAIN_ROOT="$(cd "$(git rev-parse --git-common-dir)/.." && pwd)"
  SIBLINGS_DIR="$(dirname "$MAIN_ROOT")"
  AGENT_ADAPTERS_DIR="${AGENT_ADAPTERS_DIR:-$SIBLINGS_DIR/agent-adapters}"
  AGENT_CHAT_DIR="${AGENT_CHAT_DIR:-$SIBLINGS_DIR/agent-chat}"
  docker build -f docker/Dockerfile \
    --build-arg DEPS_MODE=local \
    --build-context agent-adapters="$AGENT_ADAPTERS_DIR" \
    --build-context agent-chat="$AGENT_CHAT_DIR" \
    -t claude4spec-test:local .
elif [ "$MODE" = "registry" ]; then
  docker build -f docker/Dockerfile \
    --build-arg DEPS_MODE=registry \
    -t claude4spec-test:registry .
else
  echo "Usage: $0 [registry|local]" >&2
  exit 1
fi
