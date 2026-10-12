# u7 — non-blocking
- rev-0001 `plugins/c4s-plugin-frontend-mockups/src/entity/ui-view/frontend/module.tsx:56` — chip/card Shift+Alt+click delete calls confirmAndDeleteUiView without `remove`, skipping useDeleteUiView cache invalidation (pre-existing; callers now inconsistent).
- verifier note — unchanged spec text without a counterpart: header URL as input not monospace badge, no embedded tagged_list_mixed panel, no hasMockup/mockupBytes descriptor on Details.
