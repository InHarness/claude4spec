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
    text: {
      kind: 'string',
      required: true,
      description: 'Observable behavior the AC asserts. One sentence is best.',
    },
    kind: {
      kind: 'enum',
      values: ['requirement', 'edge-case'],
      default: 'requirement',
      description: 'requirement (default) | edge-case',
    },
    status: { kind: 'enum', values: ['active', 'deprecated'], default: 'active' },
    /**
     * A value collection WITHOUT `keyFields`, so it stays embedded JSON — the
     * shape it has always had. `slug` carries `ref: '$type'`: the target type is
     * whatever the sibling `type` field says, which is what makes a `verifies`
     * entry able to point at a plugin-contributed type the host has never heard
     * of. Rename propagation reads this flag instead of the hand-written
     * `onEntityRenamed` hook it replaces.
     */
    verifies: {
      kind: 'collection',
      collection: 'value',
      // Assignment order is not content — two ACs verifying the same set must
      // snapshot identically regardless of the order they were linked in.
      unordered: true,
      description: 'Entities this AC verifies. Reported broken if entity does not exist; not blocking.',
      item: {
        kind: 'object',
        fields: {
          type: { kind: 'string', required: true },
          slug: { kind: 'string', required: true, ref: '$type', onMissing: 'warn', onDelete: 'leave-dangling' },
        },
      },
    },
    description: { kind: 'string', clearable: true },
    createdAt: { kind: 'string', column: 'created_at', systemManaged: true, computedDefault: 'now' },
    updatedAt: { kind: 'string', column: 'updated_at', systemManaged: true, computedDefault: 'now' },
  },
  // Reproduces idx_ac_status / idx_ac_kind from the retired migration. Both are
  // hints: the host may answer them differently without ac being re-authored.
  access: [{ filter: ['status'] }, { filter: ['kind'] }],
};

/**
 * `ac-` + slugify(text) + truncate(40).
 *
 * Two behaviour changes from the retired `acSlug`, both taken from the brief
 * deliberately and both affecting only entities created from here on (a slug is
 * computed once, at create, and never recomputed):
 *   - truncation now applies to the finished slug rather than to the first 40
 *     characters of the source text, so long AC text yields a longer, more
 *     distinguishable slug;
 *   - the "text already starts with ac-" special case is gone, so such text
 *     yields `ac-ac-…`. The grammar has no conditional, and adding one would be
 *     a Host API change for a case worth a re-slug, not a grammar.
 */
export const acSlugPattern: SlugPattern = [
  { op: 'literal', value: 'ac-' },
  { op: 'slugify', field: 'text' },
  { op: 'truncate', n: 40 },
];
