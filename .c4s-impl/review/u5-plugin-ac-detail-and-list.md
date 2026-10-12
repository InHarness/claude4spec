# u5 — non-blocking
- rev-0001 `plugins/c4s-plugin-ac/src/entity/ac/frontend/detail-panel.tsx:320` — the `ac` group of the verifies picker offers the criterion itself (self-verification possible); drop the current slug from candidates.
- rev-0002 `plugins/c4s-plugin-ac/src/entity/ac/frontend/edit-popover.tsx:126` — Escape on an open EnumBadgePicker inside SlashPopoverShell closes both the dropdown and the whole ac-edit / `/ac` popover, losing unsaved edits.
- rev-0003 `plugins/c4s-plugin-ac/src/entity/ac/frontend/edit-popover.tsx:79` — removeAc duplicates useDeleteAc's onSuccess invalidation; use the hook's mutateAsync.
