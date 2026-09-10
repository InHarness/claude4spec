/**
 * An `ac`-shaped entity module, for HOST tests.
 *
 * 0.2.80 — `ac` moved into the `c4s-plugin-ac` envelope, and a dozen host tests
 * had been using its real declaration as their realistic example: the slug-
 * pattern evaluator, the search-field resolver, the CRUD schema generator, the
 * generic rename rewrite, the system-prompt assembler, and M19's consistency
 * rules 9-11. The root test program must not import from `plugins/` — the
 * `@c4s/plugin-runtime` specifier resolves there to the BUILT `dist/` .d.ts, so
 * the root typecheck would silently depend on build order — so the shape they
 * needed is declared here instead.
 *
 * This is not a downgrade in fidelity, and in one way it is an upgrade. What
 * those tests assert is a HOST mechanism, and a host mechanism has to hold for
 * whatever schema a contributor declares — pinning it to one particular
 * contributor's file was always slightly the wrong claim. The one case where the
 * real declaration IS the subject (the polymorphic `ref: '$type'` inside an
 * embedded-JSON collection, which no other type has) moved the other way, into
 * `plugins/c4s-plugin-ac/test/ref-rewrite.test.ts`, where it can keep reading
 * the real thing.
 *
 * The shape below mirrors the real one closely enough to be a fair example —
 * same fields, same order, same `unordered` value collection, same
 * `defaultPredicate` — and deliberately declares `payloadVersion: 1`, because
 * payload AGE is the envelope's business and the registry demands one upgrade
 * step per version.
 */

import type { DataDeclaration } from '../../src/shared/plugin-host/data-schema.js';
import type { SlugPattern } from '../../src/shared/plugin-host/slug-pattern.js';
import type { BackendModule } from '../../src/server/core/plugin-host/types.js';

export const acFixtureData: DataDeclaration = {
  schema: {
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
    verifies: {
      type: 'collection',
      collection: { kind: 'value', identity: ['type', 'slug'] },
      unordered: true,
      description: 'Entities this AC verifies.',
      item: {
        type: 'object',
        fields: {
          type: { type: 'string', required: true },
          slug: {
            type: 'string',
            required: true,
            ref: '$type',
            onMissing: 'warn',
            onDelete: 'leave-dangling',
          },
        },
      },
    },
    createdAt: { type: 'string', column: 'created_at', systemManaged: true, computedDefault: 'now' },
    updatedAt: { type: 'string', column: 'updated_at', systemManaged: true, computedDefault: 'now' },
  },
  access: [{ filter: ['status'] }, { filter: ['kind'] }],
};

/** `ac-` + slugify(title), truncated to 40. */
export const acFixtureSlugPattern: SlugPattern = [
  { op: 'literal', value: 'ac-' },
  { op: 'slugify', field: 'title' },
  { op: 'truncate', n: 40 },
];

/**
 * "Active is what counts, unless you say otherwise", declared as data.
 *
 * The consistency rules read this rather than restating `status = 'active'`,
 * which is the whole reason it lives on the contribution.
 */
export const acFixtureSystemPrompt = {
  roleNoun: 'Acceptance criteria',
  defaultPredicate: { field: 'status', in: ['active'] },
  mcpToolsLine: 'ac-tools: analyze_ac_against_entities',
} as const;

export const acFixtureModule = {
  type: 'ac',
  data: acFixtureData,
  slugPattern: acFixtureSlugPattern,
  // 1, not the real type's 3 — see the note above on payload age.
  payloadVersion: 1,
  slugConflict: 'suffix',
  label: 'Acceptance Criterion',
  labelPlural: 'Acceptance Criteria',
  displayOrder: 50,
  pathPrefix: '/acs',
  systemPrompt: acFixtureSystemPrompt,
} as unknown as BackendModule;
