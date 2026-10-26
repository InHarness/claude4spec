/**
 * 2.1.50 (M13 `o4ju2d7m`) — the ELEMENTS menu layout, `config.json` key
 * `elementsMenu`: an ordered list of top-level entries, each a type entry
 * (visible or hidden) or a group of types. Absent key = the flat list in
 * `sidebarTab.order`, no groups. The menu is navigation only — it never
 * affects activation, references, operations or agent tools.
 */
export interface ElementsMenuTypeEntry {
  type: string;
  /** Hides the type's ELEMENTS entry only; the type stays fully active. */
  hidden?: true;
}

export interface ElementsMenuGroupEntry {
  group: string;
  /** A name from the closed list of group icons; absent/unknown ⇒ `folder`. */
  icon?: string;
  types: string[];
}

export type ElementsMenuEntry = ElementsMenuTypeEntry | ElementsMenuGroupEntry;

export function isElementsMenuGroup(entry: ElementsMenuEntry): entry is ElementsMenuGroupEntry {
  return 'group' in entry;
}
