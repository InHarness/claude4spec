/**
 * 2.1.88 (M53 `64xb1u7b`, L15 `6jkqb2h4`) — what the chat shell reads off one
 * row of the project's context-type registry: the two columns it branches on.
 *
 * - `thread` — the `Wątek` column: the `chat_thread` column carrying the
 *   artifact reference, with the artifact kind that column belongs to (M36
 *   `artifactRegistry`, `binding.threadColumn`), or `null` for `Wątek: —`.
 * - `shell` — the `Powłoka` column: the chrome variant of the panel.
 *
 * Derived by the server from the registry (`GET /api/config` → `contextTypeRows`),
 * never a file key and never a client-side list of values.
 */
export interface ContextTypeShellRow {
  /** `Wartość` — the discriminator literal. */
  value: string;
  /** `Wątek` — `null` stands for `—` (the value has no artifact). */
  thread: { column: string; artifactKind: string } | null;
  /** `Powłoka` — the chrome variant. */
  shell: string;
}
