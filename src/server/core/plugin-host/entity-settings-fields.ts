import type { FieldDeclaration } from '../../settings/field-registry.js';
import type { PluginSettingField, PluginSettingsSection } from '../../../shared/plugin-host/manifest.js';

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

const CONTROL_TYPE: Record<PluginSettingField['control'], FieldDeclaration['type']> = {
  toggle: 'boolean',
  text: 'string',
  select: 'string',
  multiselect: 'string[]',
};

/**
 * 0.2.113 — plugin fields, declared by the plugin itself through
 * `host.listSettings()`, and only ever under `plugins.<manifest.name>`. Validation
 * covers the type alone. `executive` fields rebuild the context; `hot-reload` ones
 * act on the next turn.
 *
 * An inactive plugin declares nothing, so its card disappears and a PATCH to its
 * namespace is dropped — but its values stay in the file.
 */
export function pluginSettingsFields(sections: PluginSettingsSection[]): FieldDeclaration[] {
  return sections.flatMap((section) => {
    // A manifest is third-party input: a key it declares twice would be a registration
    // error thrown on EVERY `PATCH /config`, core fields included. The first
    // declaration wins; the duplicate is reported and left out.
    const seen = new Set<string>();
    const fields = section.fields.filter((field) => {
      if (!seen.has(field.key)) {
        seen.add(field.key);
        return true;
      }
      console.warn(`[settings] plugin "${section.name}" declares setting "${field.key}" twice — the duplicate is ignored`);
      return false;
    });
    return fields.map(
      (field): FieldDeclaration => ({
        key: `plugins.${section.name}.${field.key}`,
        path: ['plugins', section.name, field.key],
        owner: section.name,
        type: CONTROL_TYPE[field.control],
        default: field.default,
        effect: field.kind === 'executive' ? 'context-rebuild' : 'per-turn',
        resumeLock: false,
        apiWritable: true,
      }),
    );
  });
}
