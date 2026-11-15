## What I found

At 2.1.88 `ac-kazda-operacja-briefu-renderowana-w-k` and `ac-kazda-operacja-patcha-z-wartoscia-dir` read "every brief (patch) operation with `direct` in `internal` has an mcp-tool entity with server brief-tools (patch-tools)". `list_briefs` and `list_patches` are `internal: direct`, but their records name `transagent-tools-list-briefs` / `transagent-tools-list-patches`, not a brief-tools / patch-tools entity.

Slugs: ac-kazda-operacja-briefu-renderowana-w-k, ac-kazda-operacja-patcha-z-wartoscia-dir

## Suggestion

Narrow both titles to operations on ONE artifact (or name the set operations rendered on transagent-tools as the exception). Until then: ASSUMPTION:dev-brief-patch-threads-set-operations — the set operations are outside the criterion.
