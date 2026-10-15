# Review — u1-m26-ustawienia-bez-pluginow (non-blocking)

- **rev-0001** `src/server/settings/field-registry.ts:83` — `FieldDeclaration.path` and the `d.path ??` branch of `fieldPath()` are dead now that plugin settings fields are gone (only they set `path`); the SEGMENTS comment in `src/server/routes/config.ts` (~248) likewise existed only for plugins. Drop or document.
