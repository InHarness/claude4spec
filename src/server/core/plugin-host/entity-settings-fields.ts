import type { FieldDeclaration } from '../../settings/field-registry.js';
import { parseElementsMenu } from '../../config.js';
import { isElementsMenuGroup, type ElementsMenuEntry } from '../../../shared/elements-menu.js';

/**
 * 2.1.50 (M13 `o4ju2d7m`) — the SAVE rules of `elementsMenu` (2–5 of the
 * `Validation` column), on an already shape-checked list: a group label is
 * non-empty after trimming and unique among groups regardless of case, a group
 * has at least one type, and a slug appears at most once across the menu (type
 * entries, hidden ones included, and group members counted together). A slug
 * outside the effective pool or inactive is saved (rule 6). The loader does NOT
 * apply these — a merged file that breaks them loads with normalization.
 * Returns the error message, or `null` when the list may be saved.
 */
export function elementsMenuSaveError(entries: readonly ElementsMenuEntry[]): string | null {
  const labels = new Set<string>();
  const slugs = new Set<string>();
  const claim = (slug: string): string | null => {
    if (slugs.has(slug)) return `elementsMenu: type "${slug}" appears more than once in the menu`;
    slugs.add(slug);
    return null;
  };
  for (const [i, entry] of entries.entries()) {
    if (!isElementsMenuGroup(entry)) {
      const dup = claim(entry.type);
      if (dup) return dup;
      continue;
    }
    const label = entry.group.trim();
    if (label === '') return `elementsMenu[${i}]: a group label must not be empty`;
    const folded = label.toLowerCase();
    if (labels.has(folded)) return `elementsMenu[${i}]: group label "${label}" is already used by another group`;
    labels.add(folded);
    if (entry.types.length === 0) return `elementsMenu[${i}]: group "${label}" must contain at least one type`;
    for (const slug of entry.types) {
      const dup = claim(slug);
      if (dup) return dup;
    }
  }
  return null;
}

/**
 * 0.2.113 — `entities`, declared by the entity framework: axis A, the per-project
 * activation of entity types. Absent = every type active; `[]` = none (a
 * markdown-only project) — so an empty list is a value, not a missing one.
 *
 * An unknown slug is saved (the plugin may simply not be installed YET) but warned
 * about; `GET /_meta/entities` reports it as `unknown`.
 */
export function entitySettingsFields(knownEntityTypes?: () => string[]): FieldDeclaration[] {
  return [
    {
      key: 'entities',
      owner: 'entity-framework',
      type: 'string[]',
      default: undefined,
      validate: (value) => {
        if (!knownEntityTypes) return { ok: true };
        const known = new Set(knownEntityTypes());
        const unknown = (value as string[]).filter((slug) => !known.has(slug));
        return unknown.length > 0
          ? { ok: true, warning: `entities: unknown type(s) ${unknown.map((s) => `"${s}"`).join(', ')} — saved, reported as unknown` }
          : { ok: true };
      },
      effect: 'context-rebuild',
      resumeLock: false,
      apiWritable: true,
    },
    {
      // 2.1.50 (M13 `o4ju2d7m`): the ELEMENTS menu layout. Navigation only — it
      // never rebuilds the context; the whole list is replaced (last save wins).
      key: 'elementsMenu',
      owner: 'entity-framework',
      type: 'object',
      default: undefined,
      validate: (value) => {
        let entries: ElementsMenuEntry[];
        try {
          entries = parseElementsMenu(value);
        } catch (err) {
          return { ok: false, error: (err as Error).message };
        }
        const error = elementsMenuSaveError(entries);
        return error ? { ok: false, error } : { ok: true, value: entries };
      },
      effect: 'per-operation',
      resumeLock: false,
      apiWritable: true,
    },
  ];
}
