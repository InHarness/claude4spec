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
     * The criterion itself. The type's ONE authored text field, and the reserved
     * `title` slot both at once.
     *
     * Until 0.2.51 this was a LABEL derived from a separate `text`, on the
     * argument that the full criterion may run past a title's length and that
     * collapsing them would truncate the assertion. The argument held; the
     * conclusion was backwards. What it produced was a type with two authored
     * prose fields (three, counting `description`) where the second was a
     * lossy copy of the first — the editor showed a title nobody could edit,
     * the chip showed 200 characters of a sentence that continued elsewhere,
     * and search had to be told about all three names.
     *
     * So the bound moves instead of the content. `maxLength: 500` is WIDER than
     * the host's default of 200, which the host now permits, and 500 is not an
     * estimate of how long criteria get: it is a forcing function. A criterion
     * that will not fit in 500 characters is, almost always, several criteria
     * spliced together — and the honest answer to one is to split it, which is
     * why the migration into this field REFUSES rather than truncates.
     *
     * No `computedDefault`: there is nothing left to derive from, so a write
     * without a title fails input validation outright.
     */
    title: {
      type: 'string',
      required: true,
      maxLength: 500,
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
      // A verification is the PAIR (type, slug) — that is what makes two entries
      // the same link across two captures, so reshuffling the list is a noop.
      collection: { kind: 'value', identity: ['type', 'slug'] },
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
 * 0.2.22 moved the source from `text` to `title`, and 0.2.51 retired `text`
 * altogether — so the pattern reads the field that now IS the criterion. Neither
 * step changes a slug: `title` used to be the first 200 characters of `text` and
 * is now the whole of it, and 40 characters of slug never reached past 200 in
 * either case.
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
