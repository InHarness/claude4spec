# u1-elements-menu-config — non-blocking findings

- rev-0001 `src/server/core/plugin-host/entity-settings-fields.ts:12` — doc comment says a rule-breaking file "loads with normalization"; the loader returns it verbatim (normalization is u4's sidebar assembly). Reword to "loads untouched".
