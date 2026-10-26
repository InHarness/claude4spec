import type { FieldDeclaration } from '../../settings/field-registry.js';
import { parseElementsMenu } from '../../config.js';
import { elementsMenuSaveIssues, type ElementsMenuEntry } from '../../../shared/elements-menu.js';

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
      // `null` removes the key — Reset to default order (M13 `lbqrd6xh`).
      // ASSUMPTION:dev-0001 — the DTO `patch-config-request` types the field as an
      // array only; `null` is how the card's [Save] removes the key.
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
        // The save rules (2–5) live in `shared/elements-menu.ts`, shared with the
        // settings editor; the first issue refuses the whole save.
        const [issue] = elementsMenuSaveIssues(entries);
        return issue ? { ok: false, error: issue.message } : { ok: true, value: entries };
      },
      effect: 'per-operation',
      resumeLock: false,
      apiWritable: true,
      nullRemovesKey: true,
    },
  ];
}
