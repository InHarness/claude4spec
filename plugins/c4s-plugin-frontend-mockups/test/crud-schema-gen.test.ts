/**
 * The envelope's half of item 27's proof: the GENERATED CRUD schemas for
 * `ui-view` and `design-system` against the hand-written ones they replace,
 * field for field.
 *
 * `src/server/core/plugin-host/crud-schema-gen.test.ts` keeps `ac` and
 * `diagram`, the two types the host still contributes. These two moved into this
 * package in 0.2.18 and their assertions moved with them, for the reason
 * `test/projection-golden.test.ts` states: the host may not import an envelope's
 * source into the root TS program.
 *
 * The retired zod is FROZEN below — copied verbatim from the
 * `src/server/entities/{ui-view,design-system}/crud-schemas.ts` files at the
 * commit that removed them, and carried through this move unchanged. Freezing it
 * rather than dropping the comparison is the whole point: what needs saying is
 * not that the generator is stable — a snapshot of its own output says that and
 * nothing more — but that it agrees with the hand-maintained zod that used to be
 * the contract.
 *
 * The frozen half is deliberately NOT to be "fixed" when a declaration changes.
 * A delta against it is either enumerated in `CASES` with a reason, or it is a
 * regression against the shipped 0.2.8 surface.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ZodRawShape } from 'zod';

import {
  buildCreateShape,
  buildUpdateShape,
} from '../../../src/server/core/plugin-host/crud-schema-gen.js';
import { uiViewData } from '../src/entity/ui-view/schema.js';
import { designSystemData } from '../src/entity/design-system/schema.js';

// ─── FROZEN: the retired hand-written shapes, verbatim ──────────────────────

const paramSchema = z.object({
  name: z.string().describe('Parameter name (no `:` prefix)'),
  in: z.enum(['path', 'query', 'hash']).describe('Where the param lives'),
  type: z.string().optional().describe('Suggested value type (string|int|uuid|enum|...)'),
  required: z.boolean().optional(),
  default: z.string().optional(),
  description: z.string().optional(),
});

const uiViewCreateSchema: ZodRawShape = {
  title: z.string().describe('Display name (e.g. "User Profile Screen")'),
  url: z
    .string()
    .nullable()
    .optional()
    .describe('Route pattern (e.g. "/users/:id"). Null/omitted = modal/drawer without routing.'),
  description: z.string().optional(),
  params: z.array(paramSchema).optional(),
  designSystemSlug: z
    .string()
    .nullable()
    .optional()
    .describe('Slug of a design-system this view uses (no FK; dangling allowed). Null = none.'),
  slug: z.string().optional(),
  tags: z.array(z.string()).optional(),
};

const uiViewUpdateSchema: ZodRawShape = {
  title: z.string().optional(),
  url: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  params: z.array(paramSchema).optional(),
  designSystemSlug: z
    .string()
    .nullable()
    .optional()
    .describe('Set/clear the design-system reference. Null = detach. Omit = unchanged.'),
};

const tokenValueSchema = z.union([z.string(), z.record(z.string(), z.string())]);

const tokenSchema = z.object({
  name: z.string().describe('Token name, unique within the design system'),
  type: z
    .string()
    .describe(
      'TokenType (color|dimension|fontSize|...|typography|shadow). Best-effort, not hard-validated.',
    ),
  value: tokenValueSchema.describe(
    'Literal ("#2563eb", "16px"), an alias "{token-name}", or a composite object (typography/shadow).',
  ),
  description: z.string().optional(),
});

const groupSchema = z.object({
  name: z.string(),
  tier: z.enum(['primitive', 'semantic']),
  tokens: z.array(tokenSchema),
});

const modeSchema = z.object({
  name: z.string(),
  overrides: z.array(z.object({ token: z.string(), value: tokenValueSchema })),
});

const designSystemCreateSchema: ZodRawShape = {
  title: z.string().describe('Display name (e.g. "Brand 2026")'),
  description: z.string().optional(),
  groups: z.array(groupSchema).optional().describe('Token groups (default []).'),
  modes: z.array(modeSchema).optional().describe('Theme modes — token override sets (default []).'),
  slug: z.string().optional(),
  tags: z.array(z.string()).optional().describe('Tag slugs; non-existent tags are auto-created.'),
};

const designSystemUpdateSchema: ZodRawShape = {
  title: z.string().optional(),
  description: z.string().nullable().optional(),
  groups: z.array(groupSchema).optional(),
  modes: z.array(modeSchema).optional(),
};

// ─── the instrument ─────────────────────────────────────────────────────────

const keys = (shape: ZodRawShape): string[] => Object.keys(shape).sort();

/** Fields a payload MUST carry — the half of the contract a caller can violate. */
function requiredKeys(shape: ZodRawShape): string[] {
  const json = z.toJSONSchema(z.object(shape), { io: 'input' }) as { required?: string[] };
  return (json.required ?? []).slice().sort();
}

/**
 * The same question at every depth, so a nested regression cannot hide.
 * Copied verbatim from the host's suite — a frozen comparison is only frozen if
 * the instrument is too.
 */
function requiredTree(shape: ZodRawShape): Record<string, string[]> {
  const json = z.toJSONSchema(z.object(shape), { io: 'input' });
  const out: Record<string, string[]> = {};
  const walk = (node: unknown, path: string): void => {
    if (!node || typeof node !== 'object') return;
    const n = node as Record<string, unknown>;
    if (Array.isArray(n.required) && n.required.length) {
      out[path || '.'] = (n.required as string[]).slice().sort();
    }
    if (n.properties && typeof n.properties === 'object') {
      for (const [k, v] of Object.entries(n.properties as Record<string, unknown>))
        walk(v, `${path}.${k}`);
    }
    if (n.items) walk(n.items, `${path}[]`);
    // `.optional()` and `.nullable()` wrap in anyOf/oneOf; walk through them or
    // every optional object's inner required list is invisible.
    for (const key of ['anyOf', 'oneOf', 'allOf']) {
      if (Array.isArray(n[key])) for (const branch of n[key] as unknown[]) walk(branch, path);
    }
  };
  walk(json, '');
  return out;
}

/** Fields whose domain admits `null` — the tri-state's visible half. */
function nullableKeys(shape: ZodRawShape): string[] {
  const out: string[] = [];
  for (const [name, node] of Object.entries(shape)) {
    if (node.safeParse(null).success) out.push(name);
  }
  return out.sort();
}

const CASES = [
  {
    type: 'ui-view',
    data: uiViewData,
    create: uiViewCreateSchema,
    update: uiViewUpdateSchema,
    createAdds: [],
    // Every type takes `tags` on update. Two of the six hand-written shapes
    // omitted it for no stated reason — nothing about ui-view makes its tags
    // less editable than ac's.
    updateAdds: ['tags'],
  },
  {
    type: 'design-system',
    data: designSystemData,
    create: designSystemCreateSchema,
    update: designSystemUpdateSchema,
    createAdds: [],
    updateAdds: ['tags'],
  },
];

describe('item 27 — generated CRUD schemas vs the hand-written ones they replace', () => {
  describe.each(CASES)('$type', ({ data, create, update, createAdds, updateAdds }) => {
    it('create: same fields, plus only the enumerated additions', () => {
      expect(keys(buildCreateShape(data))).toEqual([...keys(create), ...createAdds].sort());
    });

    it('update: same fields, plus only the enumerated additions', () => {
      expect(keys(buildUpdateShape(data))).toEqual([...keys(update), ...updateAdds].sort());
    });

    it('create: the same fields are mandatory', () => {
      expect(requiredKeys(buildCreateShape(data))).toEqual(requiredKeys(create));
    });

    it('create: the same NESTED fields are mandatory, at every depth', () => {
      // Not a stronger restatement of the case above — a different one. The
      // `design-system` token `value` regression lived three levels down, where
      // a top-level comparison cannot see it.
      expect(requiredTree(buildCreateShape(data))).toEqual(requiredTree(create));
    });

    it('update: nothing is mandatory — omitted means unchanged', () => {
      expect(requiredKeys(buildUpdateShape(data))).toEqual([]);
    });

    it(`update: 'null' is admitted exactly where the retired shape admitted it`, () => {
      // `clearable` is the ONLY source of a null arm. If the two disagree, a
      // caller either loses the ability to clear a field or gains the ability to
      // null one the column rejects.
      expect(nullableKeys(buildUpdateShape(data))).toEqual(nullableKeys(update));
    });
  });

  it('a design-system token value accepts a literal, which its retired record node did not', () => {
    // The regression 0.2.9 would have shipped: `record<string,string>` declared
    // only the composite arm, so the commonest token in any design system — a
    // colour — failed its own create schema.
    const create = z.object(buildCreateShape(designSystemData));
    expect(
      create.safeParse({
        title: 'Brand',
        groups: [
          {
            name: 'color',
            tier: 'primitive',
            tokens: [{ name: 'brand', type: 'color', value: '#2563eb' }],
          },
        ],
      }).success,
    ).toBe(true);

    expect(
      create.safeParse({
        title: 'Brand',
        groups: [
          {
            name: 'type',
            tier: 'semantic',
            tokens: [
              {
                name: 'body',
                type: 'typography',
                value: { fontSize: '16px', lineHeight: '1.5' },
              },
            ],
          },
        ],
      }).success,
    ).toBe(true);
  });

  it('admits null on update only for a clearable field', () => {
    const update = z.object(buildUpdateShape(uiViewData));
    // `designSystemSlug` is `clearable` — null means detach.
    expect(update.safeParse({ designSystemSlug: null }).success).toBe(true);
    // `name` is not, so null is a type error and not a way to blank the row.
    expect(update.safeParse({ name: null }).success).toBe(false);
  });
});
