# Decisions

## setup
- entityTypes carried over from the 2.1.48→2.1.49 loop where the type recurs (`ac` criteria/unit, `dto` and `code-snippet` built; catalog payload versions unchanged: ac 3, dto 2, code-snippet 1), with `inCode`/`verify` re-aimed at this window's code (project config schema/loader + config routes). No `per-entity` types → no entityParts. Approved by the user with the plan.
- conventions: L5 §1–2, L17 §1–2, modules table `pages/SKILL.md` §12–14 — one line per section. The spec has no user-jobs table → `jobs: []` everywhere; the system verifier works from the units' criteria and goals.
- recipe pages: a non-contiguous change range ("sections 4, 7") is split into one page entry per contiguous range; context ranges are separate context-only entries of the same key.
- release.json: the `ask` rows answered as in 2.1.48/2.1.49 (user confirmed with the plan): tests only in env-runner (full `npm test` + `npm run test:e2e` once, at system verification), filtered = static reading + `npm run typecheck`, waiting recipient = the user in this session. startMode `resume` (delta window).
- baseline: the branch starts at main 709fe4c4, whose tree is the 2.1.48→2.1.49 branch verified in env-runner today (b11171ed: npm test 6891/6891, e2e seed-only failures) plus the removal of `.c4s-impl/` and the root version bump → baselineGreen without a new env run (tests never run locally).

## u1-elements-menu-config/p1
- Load-time handling of `elementsMenu` in u1 is TOLERANCE only: the loader (`src/server/config.ts` `parseElementsMenu`) enforces rule 1 (shape — hard load error) and keeps the list as the file holds it; it does not drop duplicate types or empty/blank groups. Applying the normalization (first occurrence wins, groups with empty label/types treated as absent, groups without a visible member omitted) is the sidebar assembly's job and is deferred to u4-elements-slot per the recipe. GET /config therefore returns the file's list verbatim, so the u5 editor sees what the team saved.
- Save rules 2–5 live with the declarant (M13) in `entity-settings-fields.ts`; the PATCH rule also runs the shape parser, so every refusal of the key — shape included — is a 400 pinned to `elementsMenu`. Effect class `per-operation` (no context rebuild), resumeLock false, apiWritable true. Wire type `object` (the closed FieldType set has no array type; a non-array is reported by the stage-1 check or by the shape parser).
- `hidden` accepts only `true` (the declared type is `hidden?: true`).

## u3-sidebar-side-menu/p1
- The side menu (`src/client/components/shell/SidebarSideMenu.tsx`) renders its panel through the catalog `Popover` (placement right — anchoring, viewport bounce, click-outside, z-tier), not through `openPopover`. The catalog `Popover` props are pinned to its `ui-kit-component` record, so no `role` prop was added to it: the menu semantics live on an inner `role="menu"` list of `role="menuitem"` links inside the Popover shell.
- "At most one open" is a module-level store (`openMenuId`) shared by every instance; opening one (click or hover) replaces the id, so the previous closes.
- Hover opens, nothing closes on mouse-leave (the spec lists the close paths: item click, Esc, click-outside, Tab/Shift+Tab, opening another). A click on the entry of a hover-opened menu keeps it open; a click on a click-opened one closes it.
- Cmd/Ctrl (any modifier) click on an item is left to the browser (new tab) and does not close the menu in the current tab.
- OTHERS item activity uses the route segment boundary (`/tags` or `/tags/...`), the trigger is highlighted when any item is active. ELEMENTS activity goes through `isElementsEntryActive(pathname, prefixes)`; in this unit each entry still covers one type — multi-type entries (groups) and ELEMENTS entries opening the side menu are u4's.
- The OTHERS fly-out (`OthersTrigger`, `FlyoutLink`) is removed; the e2e `sidebar-others-flyout.test.ts` became `sidebar-others-side-menu.test.ts` (same stacking/viewport/active assertions, now against `role="menu"` / `menuitem`).
- (round 2, rev-0001) The side menu's keydown handler acts only while focus is on its entry or inside its list (`document.activeElement` checked against `triggerRef`/`menuRef`). A hover-opened menu with focus in the editor/an input leaves ↑/↓/Enter/Tab to that field; Esc there closes the menu only through the catalog Popover's own Escape close and focus is not pulled to the entry. The render test opens menus with a focusing click (`openByClick`), as a browser click focuses the button, and a new `[section:l5pkeysm]` test pins the hover-opened/focus-elsewhere case.
- (round 2, rev-0002, non-blocking, fixed alongside since it is the same handler) Tab/Shift+Tab with focus on a menu item first moves focus to the entry, then closes, so the browser's focus move continues from the entry instead of <body>. rev-0003 (unnamed Popover dialog) left open: non-blocking and outside `only`.

## loop
- 2026-10-26 after wave 1: the user asked to run all remaining waves without stopping → `build.gates` set to [] (wave gates off); the always-on gates (stuck, blocked(review), waiting, red smoke, next window) still apply.

## u2-elements-menu-bundle-clone/p1
- `sanitizeConfigForBundle` publishes `elementsMenu` by key presence: present in the project file → copied verbatim (as the loader parsed it, shape only); absent → no key in the bundle (the clone stays on the default flat list). `BUNDLE_SCHEMA_VERSION` stays 4 (additive).
- `buildClonePatch` applies `elementsMenu` by key presence; `writeConfig` re-runs the shape parser, so a malformed layout in a bundle fails the clone and goes through the existing full rollback instead of being dropped silently.
