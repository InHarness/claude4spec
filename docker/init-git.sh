#!/usr/bin/env bash
set -euo pipefail

# Initializes a local git repo in the running container's project directory,
# so GitService.detect() (src/server/services/git.ts) finds a repo and the
# app's Git Sync UI/API can be manually exercised in the Docker test
# environment. Not wired into entrypoint.sh — run explicitly:
#
#   docker exec <container> init-git.sh
#   docker compose exec app-registry init-git.sh
#
# Idempotent: a no-op if $PROJECT_DIR is already a git repo.

PROJECT_DIR="${PROJECT_DIR:-/workspace/project}"
GIT_AUTHOR_NAME="${GIT_AUTHOR_NAME:-claude4spec Docker}"
GIT_AUTHOR_EMAIL="${GIT_AUTHOR_EMAIL:-docker@claude4spec.test}"

if [ -d "$PROJECT_DIR/.git" ]; then
  echo "Already a git repo at $PROJECT_DIR — nothing to do."
  exit 0
fi

cd "$PROJECT_DIR"
git init -b main
git config user.name "$GIT_AUTHOR_NAME"
git config user.email "$GIT_AUTHOR_EMAIL"
git add -A
git commit -m "Initial commit" --allow-empty
echo "Initialized git repo at $PROJECT_DIR (branch main)."
