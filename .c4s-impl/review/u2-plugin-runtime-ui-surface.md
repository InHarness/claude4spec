# u2-plugin-runtime-ui-surface — non-blocking review findings

- **rev-0001** `src/client/chat/BlockRenderer.tsx:531` — the declined user-input card used `--c-orange` and now uses `--c-red` (danger), so a normal decline looks like an error. `--c-yellow-ink` or `--c-subtle` would be closer. Likewise, the warnings boxes in frontend-mockups (`design-system/.../detail-panel.tsx:375`, `ui-view/.../detail-panel.tsx:271`) went from `--c-yellow-soft` to `--c-panel`, which drops the warning tint. These are visual changes to accept at the gate.
