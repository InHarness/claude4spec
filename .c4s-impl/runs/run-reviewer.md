# How to run as the reviewer (unit scope)

1. Read your instructions in full: `.c4s-impl/prompts/reviewer.md`. They are your whole prompt; follow them exactly. Never run tests. The repo is read-only for you, except that a finding about the specification goes to `.c4s-impl/deviations/<id>.json` per `.c4s-impl/schemas/deviation.json` (next free `dev-NNNN`, `sent: false`).
2. Your scope block is the file named in your task; it names the unit and the base commit. The diff to review: `git diff <base>..HEAD -- . ':!.c4s-impl'`. Map findings to portions via `.c4s-impl/state.json` → units[id=<unit>].portions (commit subjects name the portion; use `git log --format='%h %s' <base>..HEAD -- <file>`).
3. Read `.c4s-impl/decisions.md` and earlier `.c4s-impl/review/*.md` — do not raise again a finding already recorded there for an earlier unit unless this diff makes it worse.
4. Finding ids follow `^rev-[0-9]{4}$`; continue numbering after the highest id in `.c4s-impl/review/*.json`.
5. Write your final JSON (per `.c4s-impl/schemas/review.json`, no extra keys) to the output path named in your task, and return only that JSON as your final message — no prose around it.
