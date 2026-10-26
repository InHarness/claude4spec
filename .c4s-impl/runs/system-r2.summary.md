# System verification — env-runner evidence (2-1-49-to-2-1-50)

- r1 @ 9fdc7c51: typecheck 0, build 0; npm test 1 failed suite (SidebarMenuElement.render.test.ts import cycle → fixed in u5 round 3, ad4007a2) + chat.live-join timeout; e2e 3 failed (seed-only + envelope slash). Logs: envs/2-1-49-to-2-1-50.r1-archive/.
- r2 @ ad4007a2 (destroy + create: app code changed): typecheck 0, build 0, **npm test 6950/6950**; e2e 4 failed tests / 200 passed / 19 skipped:
  - seed-only ("seed one first"), same set as 2.1.48/2.1.49: artifact-threads-panel, entity-version-history, plan-footer, envelope-entity-pages (deep link, pinned breadcrumb);
  - editor-l8-contexts "root kind";
  - frontend-mockups-envelope "/design-system is offered once".
  - new tests/e2e/sidebar-others-side-menu.test.ts green.
- r2 isolated 3x: chat.live-join 9/9 ×3; envelope-entity-pages slash 1/1 ×3; SidebarMenuElement.render + settings 32/32 ×3.
- r3 isolated 3x (same env): frontend-mockups-envelope 6/6 ×3 → flake; editor-l8-contexts 1 green / 2 red ("root kind") — the same 2/3 rate measured on main (env 2-1-47-main-l8 @ 5219cb24, 2.1.48 window); the branch changes no editor/L8 code (only mountFrontend.smoke.test.ts under src/client/tiptap) → pre-existing.
- Logs: /Users/michael/Code/ctowiec/claude4spec-private/env-runner/envs/2-1-49-to-2-1-50.* (r2) and .r3-iso-* (r3).
