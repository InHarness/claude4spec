# m54-settings-ui — non-blocking review findings (round 1)

- **rev-0001** `src/client/ui/events.ts:107` — komentarz `ConfirmKind 'runner-host-remove'` mówi o payloadzie `{ id }`, a `RunnerHostsElement.remove()` wywołuje `confirmDestructive` bez payloadu (id w domknięciu akcji).
- **rev-0002** `src/client/components/runner-hosts/RunnerHostDialog.tsx:133` — `onClose` dialogu (Esc/tło/Cancel) aktywny podczas trwającego zapisu; anulowanie w trakcie POST/PATCH pomija `refresh()` i toast, host pojawia się dopiero przy następnym pollingu 5 s.
