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

/** Where a save-rule error of `elementsMenu` sits: the entry, and its label or its type list. */
export interface ElementsMenuSaveIssue {
  /** Index of the top-level entry the error belongs to. */
  index: number;
  /** `label` — rules 2–3 (a group's label); `types` — rule 4 and rule 5 (a type list / a type entry). */
  at: 'label' | 'types';
  message: string;
}

/**
 * 2.1.50 (M13 `o4ju2d7m`) — the SAVE rules of `elementsMenu` (2–5 of the
 * `Validation` column), on an already shape-checked list: a group label is
 * non-empty after trimming and unique among groups regardless of case, a group
 * has at least one type, and a slug appears at most once across the menu (type
 * entries, hidden ones included, and group members counted together). A slug
 * outside the effective pool or inactive is saved (rule 6). The loader does NOT
 * apply these — a merged file that breaks them loads with normalization.
 *
 * One implementation for both halves: the PATCH rule refuses on the first
 * issue, the settings editor shows every issue beside the group label or the
 * type list it concerns.
 */
export function elementsMenuSaveIssues(entries: readonly ElementsMenuEntry[]): ElementsMenuSaveIssue[] {
  const issues: ElementsMenuSaveIssue[] = [];
  const labels = new Set<string>();
  const slugs = new Set<string>();
  const claim = (index: number, slug: string) => {
    if (slugs.has(slug)) {
      issues.push({ index, at: 'types', message: `elementsMenu: type "${slug}" appears more than once in the menu` });
    }
    slugs.add(slug);
  };
  for (const [i, entry] of entries.entries()) {
    if (!isElementsMenuGroup(entry)) {
      claim(i, entry.type);
      continue;
    }
    const label = entry.group.trim();
    if (label === '') {
      issues.push({ index: i, at: 'label', message: `elementsMenu[${i}]: a group label must not be empty` });
    } else {
      const folded = label.toLowerCase();
      if (labels.has(folded)) {
        issues.push({ index: i, at: 'label', message: `elementsMenu[${i}]: group label "${label}" is already used by another group` });
      }
      labels.add(folded);
    }
    if (entry.types.length === 0) {
      issues.push({ index: i, at: 'types', message: `elementsMenu[${i}]: group "${label}" must contain at least one type` });
    }
    for (const slug of entry.types) claim(i, slug);
  }
  return issues;
}
