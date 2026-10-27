# m53-stan-tury unit verifier r1 — open rows (43/45 covered)

- `ac-po-f5-ui-pokazuje-pelna-tresc-trwajac` — test-not-verifying: the second half (user notice on `replayTruncated`) is unbuilt per dev-0006; agent-chat 0.4.0 consumeWireStream sends `connected` only to `onConnected(requestId, threadId)`, so useChat.ts:538 toast branch is unreachable.
- `goal:m53-stan-tury` — uncovered: same gap, the goal's "komunikat o przyciętym replayu".
