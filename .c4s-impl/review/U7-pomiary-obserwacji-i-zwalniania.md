# U7-pomiary-obserwacji-i-zwalniania — non-blocking review findings

- round 1, rev-0001 (`src/server/mcp/http-mount.ts:193`): race between re-sync and handler lookup on an immediate dispose → tools/call NOT_FOUND with a misleading "plugin pool changed" hint (previously it dispatched into a disposed context). Not a new failure mode. Suggested: re-sync from the live context or a retryable "context rebuilt" error.
