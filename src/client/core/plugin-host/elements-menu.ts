import {
  BookOpen,
  Box,
  Boxes,
  Component,
  Database,
  FileCode,
  FileText,
  Folder,
  Globe,
  Layers,
  LayoutGrid,
  ListChecks,
  Network,
  Package,
  Puzzle,
  Server,
  Settings,
  Shield,
  Tag,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import type { FrontendModule, SidebarTabSlot } from './types.js';
import { isElementsMenuGroup, type ElementsMenuEntry } from '../../../shared/elements-menu.js';

/**
 * 2.1.50 (M13 `8a4oxdg4`) — the closed list of group icons. Its composition is
 * an implementation decision; a group whose `icon` is absent or not on the list
 * gets the default `folder`.
 */
export const GROUP_ICONS: Readonly<Record<string, LucideIcon>> = {
  folder: Folder,
  layers: Layers,
  box: Box,
  boxes: Boxes,
  package: Package,
  database: Database,
  server: Server,
  network: Network,
  globe: Globe,
  workflow: Workflow,
  component: Component,
  'layout-grid': LayoutGrid,
  'file-code': FileCode,
  'file-text': FileText,
  'book-open': BookOpen,
  'list-checks': ListChecks,
  puzzle: Puzzle,
  shield: Shield,
  tag: Tag,
  settings: Settings,
};

/** The group's icon: its name on the closed list, otherwise the default `folder`. */
export function groupIcon(name: string | undefined): LucideIcon {
  if (name !== undefined && Object.hasOwn(GROUP_ICONS, name)) return GROUP_ICONS[name]!;
  return Folder;
}

/** An active module that declares a sidebar tab — the only kind with an ELEMENTS presence. */
export type SidebarModule = FrontendModule & { sidebarTab: SidebarTabSlot };

export type ElementsSlotEntry =
  | { kind: 'type'; module: SidebarModule }
  | { kind: 'group'; label: string; icon: LucideIcon; members: SidebarModule[] };

/** A module that declares a sidebar tab. */
export const hasSidebarTab = (m: FrontendModule | null | undefined): m is SidebarModule => m?.sidebarTab !== undefined;

/**
 * The DEFAULT order of ELEMENTS (`sidebarTab.order`, absent = 999) — one rule
 * for the slot and the Sidebar menu editor's options.
 */
export const byDefaultOrder = (modules: Iterable<SidebarModule>): SidebarModule[] =>
  [...modules].sort((a, b) => (a.sidebarTab.order ?? 999) - (b.sidebarTab.order ?? 999));

/**
 * 2.1.50 (M13 `m13ui000`, `e8xcx6g7`, `8mwihe60`, `5kkkih9i`) — the ELEMENTS
 * slot, composed from the active modules and the team's layout:
 *
 *  - no layout (`elementsMenu` absent) → one type entry per visible type, in
 *    `sidebarTab.order` — the DEFAULT order;
 *  - otherwise the layout's entries in file order, then every visible type the
 *    layout does not place, in `sidebarTab.order`.
 *
 * A type is visible when it is active and declares a `sidebarTab`. A slug that
 * is inactive, unknown or tab-less stays in the file and is skipped here. A
 * type occupies at most one place: its first occurrence in file order wins (a
 * later type entry, hidden entry or group membership of the same slug is
 * dropped). A hidden type has no entry at all and is not appended at the end;
 * its route, references and tools are untouched — this is navigation only.
 * A group's members are its visible types in `types` order; a group without a
 * visible member has no entry, and a group with one stays a group. A group whose
 * label is blank or whose `types` is empty (save rules 2 and 4, broken only by
 * a hand edit or a merge) is treated as absent: it places nothing, so its
 * members land at the end with the other unplaced types.
 */
export function composeElementsSlot(
  active: readonly FrontendModule[],
  layout: readonly ElementsMenuEntry[] | undefined,
): ElementsSlotEntry[] {
  const visible = new Map(active.filter(hasSidebarTab).map((m) => [m.type, m] as const));
  if (layout === undefined) {
    return byDefaultOrder(visible.values()).map((module) => ({ kind: 'type', module }));
  }
  const placed = new Set<string>();
  const entries: ElementsSlotEntry[] = [];
  for (const entry of layout) {
    if (isElementsMenuGroup(entry)) {
      if (entry.group.trim() === '' || entry.types.length === 0) continue;
      const members: SidebarModule[] = [];
      for (const type of entry.types) {
        if (placed.has(type)) continue;
        placed.add(type);
        const module = visible.get(type);
        if (module) members.push(module);
      }
      if (members.length > 0) {
        entries.push({ kind: 'group', label: entry.group, icon: groupIcon(entry.icon), members });
      }
      continue;
    }
    if (placed.has(entry.type)) continue;
    placed.add(entry.type);
    if (entry.hidden) continue;
    const module = visible.get(entry.type);
    if (module) entries.push({ kind: 'type', module });
  }
  for (const module of byDefaultOrder([...visible.values()].filter((m) => !placed.has(m.type)))) {
    entries.push({ kind: 'type', module });
  }
  return entries;
}
