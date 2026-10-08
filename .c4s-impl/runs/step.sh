#!/bin/sh
# orchestrator helper: apply a portion verdict, ship deviations, commit, print the next step
# usage: step.sh <portion> <verdict.json>
set -e
P="$1"; V="$2"
node .c4s-impl/runs/validate.cjs verdict="$V"
R=$(python3 .c4s-impl/runs/orch.py verdict "$P" "$V"); echo "$R"
python3 .c4s-impl/runs/ship.py
git add -A src tests plugins 2>/dev/null || true
git add -f .c4s-impl ':!.c4s-impl/packets'
git commit -qm "impl($P): $R

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
python3 .c4s-impl/runs/orch.py next
