import type { FieldDeclaration } from '../../settings/field-registry.js';

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
  ];
}
