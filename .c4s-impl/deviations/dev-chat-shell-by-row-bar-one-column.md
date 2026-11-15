## What I found

M53 64xb1u7b (2.1.88) puts the artifact bar on the row: it renders when the row's `Wątek` column names an artifact and the thread has it, labelled by the artifact kind; the new criterion ac-belka-context-link-nie-renderuje-sie says no bar for a value with `Wątek: —`. M53 impolq96 (Composer i belki) still says the bar shows `Plan: …` 'przy wątku z przypiętym planem, także `ask`' and lists the per-type labels `Plan:`/`Brief:`/`Patch:` — `ask` has `Wątek: —`, so the two sections disagree. impolq96 also mentions the plan's version number in the label, which 64xb1u7b does not carry. Built per 64xb1u7b and the criteria: one bar, the artifact of the row's `Wątek` column; label `<Kind>: <title or file name>` from the artifact kind; no bar in `ask`, nor for a plan attached to a thread whose row names another column (a `patch` thread with a plan shows only `Patch: …`); no version number. Please align impolq96 with 64xb1u7b (drop 'także ask' and the per-type label list), and say whether an attached plan on an anchored thread (M36 m36bind01 coexistence) gets its own bar.

Slugs: ac-belka-context-link-nad-composerem-pok, ac-belka-context-link-nie-renderuje-sie

## Suggestion

Align M53 `impolq96` with `64xb1u7b`: drop "także `ask`" and the per-type label list, and say whether a plan attached to an anchored thread gets its own bar. Until then the code follows `64xb1u7b`: ASSUMPTION:chat-shell-by-row-bar-one-column: one bar, the artifact of the row's `Wątek` column only — a plan attached to a thread whose row names another column gets no bar of its own, and `ask` (`Wątek: —`) none.
