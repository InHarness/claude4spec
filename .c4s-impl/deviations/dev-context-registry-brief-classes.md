## What I found

The `brief` row (M21 m21ctxreg, 2.1.88) declares `Klasy operacji: wszystkie`. Until 2.1.87 the brief profile admitted only `read` and `brief`. Built as written, a brief thread's turn now also gets the write tools of `release-tools` (`release_create`, `release_update`), which a brief thread did not have before. The external `mcp` channel's `brief` profile (M12 ecawzsbr) still renders only the common reads and the brief tools: it is not in this unit and was left unchanged. Please confirm the brief row should be `wszystkie` rather than `read`, `brief`.

Slugs: ac-narzedzie-klasy-spoza-klasy-operacji

## Suggestion

Confirm that the `brief` row's `Klasy operacji` should be `wszystkie`, or change it to `read`, `brief` (the 2.1.87 behaviour). Until then the code follows the spec as written: ASSUMPTION:dev-context-registry-brief-classes: built as the spec says (`all` classes for the brief row in the turn); the mcp-channel brief profile is unchanged.
