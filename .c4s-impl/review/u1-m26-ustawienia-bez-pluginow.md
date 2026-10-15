# Review — u1-m26-ustawienia-bez-pluginow (non-blocking)

- **rev-0001** `src/server/settings/field-registry.ts:83` — `FieldDeclaration.path` and the `d.path ??` branch of `fieldPath()` are dead now that plugin settings fields are gone (only they set `path`); the SEGMENTS comment in `src/server/routes/config.ts` (~248) likewise existed only for plugins. Drop or document.

## Round 2 (reopen — 13 settings-page criteria)

- **rev-0002** `src/client/components/external-integrations/ExternalIntegrationsElements.render.test.ts:70` — `navigator.clipboard` and `URL.createObjectURL/revokeObjectURL` replaced in beforeEach and never restored; harmless under per-file isolation, but `vi.stubGlobal`/`vi.spyOn` would be cleaner.
