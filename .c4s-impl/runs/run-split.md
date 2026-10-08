# How to run as the implementer (split mode)

1. Read your instructions in full: `.c4s-impl/prompts/implementer.md`. They are your whole prompt; follow them exactly — including the sections at the end that override the role text.
2. Your scope block is the file named in your task (mode `split`).
3. Assemble the unit's packet with `c4s release-diff` reads (write it to `.c4s-impl/packets/<unit>.md`; if over budget, also one packet per portion as `.c4s-impl/packets/<unit>-<pN-…>.md`), then cut it per "Split mode". Portions carry the unit's active criteria (`ac-…`) and built entities; where a portion holds no criterion, list the changed sections it covers as `section:<anchor>` slugs (the convention already used in this build). Write no code and no state besides packets. Run no tests. The c4s server is occasionally flaky: retry a failed command a few times with a short pause.
4. Write your final JSON (per `.c4s-impl/schemas/split.json`; include `deviations` only for a blocking read problem, as an array of strings) to the output path named in your task, and return only that JSON as your final message — no prose around it.
