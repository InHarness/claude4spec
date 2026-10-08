#!/bin/sh
# orchestrator helper: verify(u) — squash u.baseCommit..HEAD (plus the working tree) into one commit
#   "unit(<unit>): <goal, first sentence> — <counts>"
# A checkpoint already on the upstream is never rewritten: then the unit commit is a plain commit on top.
# usage: unit-commit.sh <unit> "<covered>/<total>[ + …]"
set -e
U="$1"; C="$2"
BASE=$(python3 -c "import json;print(next(u for u in json.load(open('.c4s-impl/state.json'))['units'] if u['id']=='$U')['baseCommit'])")
GOAL=$(python3 -c "
import json,re;g=next(u for u in json.load(open('.c4s-impl/state.json'))['units'] if u['id']=='$U')['goal'].splitlines()[0]
print(re.split(r'(?<=[.])\s', g)[0].rstrip(':.').strip())")
BODY=$(git log --reverse --format='- %s' "$BASE"..HEAD)
git add -A src tests plugins 2>/dev/null || true
git add -f .c4s-impl ':!.c4s-impl/packets'
UP=$(git rev-parse -q --verify '@{u}' || true)
if [ -n "$UP" ] && [ "$(git rev-list --count "$BASE"..HEAD)" != "$(git rev-list --count "$BASE"..HEAD --not "$UP")" ]; then
  echo "checkpoints already upstream: plain commit on top"
else
  git reset -q --soft "$BASE"
fi
git commit -qm "unit($U): $GOAL — $C

Squashed checkpoints:
$BODY

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
git log --oneline -1
python3 .c4s-impl/runs/orch.py next
