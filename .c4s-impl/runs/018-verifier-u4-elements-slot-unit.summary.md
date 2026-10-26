u4 unit-verifier r1: 23/24 covered (typecheck green)
- test-not-verifying ac-wpisy-w-sekcji-elements-sidebara-derywow: SidebarElementsMenu.render.test.ts:167 asserts only derivation/order and that the tab-less type has no entry. Not asserted: (a) the tab-less plugin's type is still active in references (no isActive/getEntity check on em-tabless); (b) the Pages tree (M02) and the OTHERS submenu (Tags from M18) do not use this mechanism.
- note: stale comments in plugins/c4s-plugin-{database-tables,frontend-mockups,ac}/src/identity.ts ('since 2.1.26 the only ordering a type') — comments only.
