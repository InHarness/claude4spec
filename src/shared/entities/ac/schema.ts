import type { DataDeclaration } from '../../plugin-host/data-schema.js';
import type { SlugPattern } from '../../plugin-host/slug-pattern.js';

/**
 * Host API 2.0.0 — what `ac` IS, declared once.
 *
 * Replaces `migrations.ts` (the DDL), `slugFrom` (the identity) and, in later
 * tiers, `crud-schemas.ts` and the serializer's snapshot/restore. Field ORDER is
 * load-bearing: it is the column order of the generated table, and the
 * baseline-identity gate compares `PRAGMA table_info` positionally.
 */
export const acData: DataDeclaration = {
  schema: {
    /**
     * Derived from `text`, because an AC's name IS its text — asking an author
     * for both would be asking the same question twice.
     *
     * `text` STAYS beside it rather than being replaced: the full criterion is
     * the thing being asserted and may run well past 200 characters, while a
     * title is a label. Collapsing them would truncate the criterion itself.
     */
    title: {
      type: 'string',
      required: true,
      maxLength: 200,
      computedDefault: [
        { op: 'raw', field: 'text' },
        { op: 'truncate', n: 200 },
      ],
      description: 'Label. Defaults to the first 200 characters of `text`.',
    },
    text: {
      type: 'string',
      required: true,
      description: 'Observable behavior the AC asserts. One sentence is best.',
    },
    kind: {
      type: 'enum',
      values: ['requirement', 'edge-case'],
      default: 'requirement',
      description: 'requirement (default) | edge-case',
    },
    status: { type: 'enum', values: ['active', 'deprecated'], default: 'active' },
    /**
     * A value collection WITHOUT `keyFields`, so it stays embedded JSON — the
     * shape it has always had. `slug` carries `ref: '$type'`: the target type is
     * whatever the sibling `type` field says, which is what makes a `verifies`
     * entry able to point at a plugin-contributed type the host has never heard
     * of. Rename propagation reads this flag instead of the hand-written
     * `onEntityRenamed` hook it replaces.
     */
    verifies: {
      type: 'collection',
      collection: 'value',
      // Assignment order is not content — two ACs verifying the same set must
      // snapshot identically regardless of the order they were linked in.
      unordered: true,
      description: 'Entities this AC verifies. Reported broken if entity does not exist; not blocking.',
      item: {
        type: 'object',
        fields: {
          type: { type: 'string', required: true },
          slug: { type: 'string', required: true, ref: '$type', onMissing: 'warn', onDelete: 'leave-dangling' },
        },
      },
    },
    description: { type: 'string', clearable: true },
    createdAt: { type: 'string', column: 'created_at', systemManaged: true, computedDefault: 'now' },
    updatedAt: { type: 'string', column: 'updated_at', systemManaged: true, computedDefault: 'now' },
  },
  // Reproduces idx_ac_status / idx_ac_kind from the retired migration. Both are
  // hints: the host may answer them differently without ac being re-authored.
  access: [{ filter: ['status'] }, { filter: ['kind'] }],
};

/**
 * `ac-` + slugify(title) + truncate(40).
 *
 * 0.2.22 moves the source from `text` to `title`. In practice the slug does not
 * change: `title` defaults to the first 200 characters of `text`, and 40
 * characters of slug never reach past that — so an AC created before and after
 * this release from the same text gets the same slug.
 *
 * Two older behaviour notes still hold, both affecting only entities created
 * from here on (a slug is computed once, at create, and never recomputed):
 *   - truncation applies to the finished slug rather than to the first 40
 *     characters of the source, so long AC text yields a longer, more
 *     distinguishable slug;
 *   - the "text already starts with ac-" special case is gone, so such text
 *     yields `ac-ac-…`. The grammar has no conditional, and adding one would be
 *     a Host API change for a case worth a re-slug, not a grammar.
 */
export const acSlugPattern: SlugPattern = [
  { op: 'literal', value: 'ac-' },
  { op: 'slugify', field: 'title' },
  { op: 'truncate', n: 40 },
];
