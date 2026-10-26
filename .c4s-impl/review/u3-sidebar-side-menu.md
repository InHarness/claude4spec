# u3-sidebar-side-menu — non-blocking findings

## round 1
- rev-0002 `SidebarSideMenu.tsx:126` — Tab/Shift+Tab from a focused menu item closes the menu before the browser moves focus → focus may fall to <body>. Move focus to the trigger first.
- rev-0003 `SidebarSideMenu.tsx:191` — role=menu nested in the catalog Popover's role=dialog with no aria-label (no title passed) → unnamed dialog announced.
- (verifier note) stale `OTHERS_PATHS` comment at `tests/e2e/sidebar-others-side-menu.test.ts:156`.

## round 2
- no findings (rev-0001 fixed: keys handled only with focus on the entry or in the menu; Tab from an item now returns focus to the entry, which also addresses rev-0002)
