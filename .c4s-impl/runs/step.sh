#!/bin/sh
# orchestrator helper: apply an implementer run to its portion, ship deviations, checkpoint-commit, print the next step
# usage: step.sh <portion> <iteration-status.json>   (a missing/invalid file counts as stoppedEarly)
P="$1"; S="$2"
if [ -f "$S" ] && node .c4s-impl/runs/validate.cjs iteration-status="$S"; then :; else S=/nonexistent; fi
R=$(python3 .c4s-impl/runs/orch.py implemented "$P" "$S") || exit 1; echo "$R"
python3 .c4s-impl/runs/ship.py
git add -A src tests plugins 2>/dev/null || true
git add -f .c4s-impl ':!.c4s-impl/packets'
git commit -qm "impl($P): $R

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
python3 .c4s-impl/runs/orch.py next
