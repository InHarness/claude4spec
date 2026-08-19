/**
 * The type icon — ONE reference used in two places, the `sidebarTab.icon` and
 * the list screen's `EntityListHeader`. The host has no "type icon" contract, so
 * keeping a single reference here is what keeps the tab and the header in sync.
 *
 * `WrenchIcon` from `lucide-react`, which the brief names and the slot's type
 * (`LucideIcon`) already expects. It is a DECLARED, EXTERNALIZED peer — listed
 * in this package's `vite.config.ts` externals and resolved in the browser
 * through the host's import map — so this imports the host's single copy rather
 * than bundling a second one.
 */
export { Wrench as McpToolIcon } from 'lucide-react';
