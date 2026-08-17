/**
 * Item 27's proof: the GENERATED CRUD schemas against the hand-written ones
 * they replace, field for field.
 *
 * Same instrument as tier A's `projection.golden.test.ts`. Tier E could import
 * the retired schemas because they were still in the tree; **tier K deleted
 * them**, so they are FROZEN below instead — copied verbatim from the six
 * `crud-schemas.ts` files at the commit that removed them
 * (`src/server/entities/{ac,diagram,ui-view,design-system}/crud-schemas.ts`).
 *
 * Freezing them rather than dropping the comparison is the whole point of the
 * file. What needs saying is not that the generator is stable — a snapshot of
 * its own output says that and nothing more — but that it agrees with the
 * hand-maintained zod that used to be the contract. That claim outlives the
 * files; it just has to carry its own copy of the other side.
 *
 * The frozen half is deliberately NOT to be "fixed" when a declaration changes.
 * A delta against it is either enumerated in `CASES` with a reason, or it is a
 * regression against the shipped 0.2.8 surface.
 *
 * Every difference is ENUMERATED below and asserted. A delta that is not in
 * that table fails the test — that is the only way a golden earns its keep.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ZodRawShape } from 'zod';

import { buildCreateShape, buildUpdateShape } from './crud-schema-gen.js';
import { acData } from '../../../shared/entities/ac/schema.js';
import { diagramData } from '../../../shared/entities/diagram/schema.js';
import type { DataDeclaration } from '../../../shared/plugin-host/data-schema.js';
import type { SlugPattern } from '../../../shared/plugin-host/slug-pattern.js';

// ─── FROZEN: the retired hand-written shapes, verbatim ──────────────────────

const acCreateSchema: ZodRawShape = {
  // Optional on create despite being required on the entity: `computedDefault`
  // derives it from `text`, which is the whole point of asking the author once.
  title: z.string().optional().describe('Label. Defaults to the first 200 characters of `text`.'),
  text: z.string().describe('Observable behavior the AC asserts. One sentence is best.'),
  kind: z.enum(['requirement', 'edge-case']).optional().describe('requirement (default) | edge-case'),
  status: z.enum(['active', 'deprecated']).optional(),
  verifies: z
    .array(z.object({ type: z.string(), slug: z.string() }))
    .optional()
    .describe('Entities this AC verifies. Reported broken if entity does not exist; not blocking.'),
  description: z.string().optional(),
  slug: z.string().optional().describe('Optional explicit slug; otherwise auto-generated.'),
  tags: z
    .array(z.string())
    .optional()
    .describe('Tag slugs. Convention: m07 for module M07, entity-dto for DTO entity, etc.'),
};

const acUpdateSchema: ZodRawShape = {
  title: z.string().optional(),
  text: z.string().optional(),
  kind: z.enum(['requirement', 'edge-case']).optional(),
  status: z.enum(['active', 'deprecated']).optional(),
  verifies: z.array(z.object({ type: z.string(), slug: z.string() })).optional(),
  description: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
};

const diagramCreateSchema: ZodRawShape = {
  // 0.2.22 — `title` arrives, `caption` leaves. The caption was a transient that
  // existed only to seed the slug; the slug comes from the title now, and the
  // caption survives outside the entity as an attribute of the reference tag.
  title: z.string().describe('Label, e.g. "Checkout sequence".'),
  source: z.string().optional().describe('DSL body (mermaid). May be empty (placeholder).'),
  format: z.enum(['mermaid', 'd2']).optional().describe("Diagram language (default 'mermaid')."),
  slug: z.string().optional().describe('Explicit slug; collisions get a -2/-3 suffix.'),
  tags: z.array(z.string()).optional().describe('Tag slugs; non-existent tags are auto-created.'),
};

const diagramUpdateSchema: ZodRawShape = {
  title: z.string().optional(),
  source: z.string().optional(),
  format: z.enum(['mermaid', 'd2']).optional(),
  tags: z.array(z.string()).optional(),
};

const keys = (shape: ZodRawShape): string[] => Object.keys(shape).sort();

/** Fields a payload MUST carry — the half of the contract a caller can violate. */
function requiredKeys(shape: ZodRawShape): string[] {
  const json = z.toJSONSchema(z.object(shape), { io: 'input' }) as { required?: string[] };
  return (json.required ?? []).slice().sort();
}

/**
 * Every `required` list in the schema, at EVERY depth, keyed by its path.
 *
 * The flat `requiredKeys` above compares the top level only, and a real defect
 * hid under exactly that: swapping `design-system`'s token value from a `record`
 * node to a `json` one dropped its mandatory-ness, because `required` travels on
 * the node. `{name, type}` with no `value` became a legal token and the golden
 * was silent, since `value` is a field of a collection ITEM, not of the type.
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
      for (const [k, v] of Object.entries(n.properties as Record<string, unknown>)) walk(v, `${path}.${k}`);
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

interface Case {
  type: string;
  data: DataDeclaration;
  create: ZodRawShape;
  update: ZodRawShape;
  /** Keys the GENERATED create shape has and the retired one did not. */
  createAdds: string[];
  /** Keys the GENERATED update shape has and the retired one did not. */
  updateAdds: string[];
}

/**
 * The two in-repo types. Every other type lives in an envelope and is covered by
 * that package's own suite — importing across the workspace boundary here is
 * exactly the coupling the envelope exists to prevent.
 */
const CASES: Case[] = [
  {
    type: 'ac',
    data: acData,
    create: acCreateSchema,
    update: acUpdateSchema,
    createAdds: [],
    updateAdds: [],
  },
  {
    type: 'diagram',
    data: diagramData,
    create: diagramCreateSchema,
    update: diagramUpdateSchema,
    /**
     * `firstSourceIdentifier` went with `caption` in 0.2.22 — both were
     * transients feeding a slug chain that collapsed to `slugify(title)`.
     */
    createAdds: [],
    updateAdds: [],
  },
];

describe('item 27 — generated CRUD schemas vs the hand-written ones they replace', () => {
  describe.each(CASES)('$type', ({ type, data, create, update, createAdds, updateAdds }) => {
    it('create: same fields, plus only the enumerated additions', () => {
      const generated = buildCreateShape(data);
      expect(keys(generated)).toEqual([...keys(create), ...createAdds].sort());
    });

    it('update: same fields, plus only the enumerated additions', () => {
      const generated = buildUpdateShape(data);
      expect(keys(generated)).toEqual([...keys(update), ...updateAdds].sort());
    });

    it('create: the same fields are mandatory', () => {
      // The one rule most likely to drift, because the declaration spells it
      // with three flags (`required` / `default` / `computedDefault`) and the
      // retired zod spelled it with the presence of `.optional()`.
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
      // caller either loses the ability to clear a field or gains the ability
      // to null one the column rejects.
      expect(nullableKeys(buildUpdateShape(data))).toEqual(nullableKeys(update));
    });
  });

  it('rejects an unknown enum value rather than coercing it', () => {
    // `diagram.format` is the case the brief names: the retired read path
    // mapped everything that was not `d2` onto `mermaid`, silently.
    const create = z.object(buildCreateShape(diagramData));
    expect(create.safeParse({ title: 'Flow', source: 'graph TD', format: 'graphviz' }).success).toBe(false);
    expect(create.safeParse({ title: 'Flow', source: 'graph TD', format: 'd2' }).success).toBe(true);
  });

  it('omits systemManaged timestamps from both shapes', () => {
    // The host writes them from the file; a caller offering one is offering to
    // corrupt the `file → index → file` fixpoint.
    for (const { data } of CASES) {
      expect(keys(buildCreateShape(data))).not.toContain('createdAt');
      expect(keys(buildUpdateShape(data))).not.toContain('updatedAt');
    }
  });

  it('carries the declared descriptions through to the JSON Schema an agent reads', () => {
    // The reason `description` was added to `FieldFlags` at all: generating
    // from a declaration with nowhere to put prose would have deleted every
    // `.describe()` in the six retired files, silently.
    const json = z.toJSONSchema(z.object(buildCreateShape(acData)), { io: 'input' }) as {
      properties: Record<string, { description?: string }>;
    };
    expect(json.properties.text?.description).toBe(
      'Observable behavior the AC asserts. One sentence is best.',
    );
  });
});

/**
 * The string constraints, and the composition that makes one of them reachable.
 *
 * `kind` — the named validator — exists for a type whose payload field becomes a
 * SQL identifier somewhere the host cannot see: `database-table.title` is a real
 * table name in someone else's schema. That field is also, necessarily, the field
 * the type SLUGIFIES, which is what makes the second half of this block the
 * load-bearing one.
 *
 * 0.2.27 replaced the pair this block used to cover (a raw `pattern` string and a
 * `notReserved: 'sql'` flag) with one named validator. The rules did not change —
 * shape and reserved-word membership are still screened separately and still
 * produce different messages — only where they are written down.
 */
describe('string constraints', () => {
  const shapeFor = (node: Record<string, unknown>, slug?: SlugPattern) =>
    z.object(buildCreateShape({ schema: { name: node as never } }, slug));

  it('applies a named validator', () => {
    const s = shapeFor({ type: 'string', required: true, kind: 'sql-identifier' });
    expect(s.safeParse({ name: 'order_items' }).success).toBe(true);
    expect(s.safeParse({ name: 'Order_Items' }).success).toBe(true);
    expect(s.safeParse({ name: 'order items' }).success).toBe(false);
    expect(s.safeParse({ name: '2fast' }).success).toBe(false);
    expect(s.safeParse({ name: 'order-list' }).success).toBe(false);
  });

  it('refuses a reserved SQL word, case-insensitively, as part of the same validator', () => {
    const s = shapeFor({ type: 'string', required: true, kind: 'sql-identifier' });
    expect(s.safeParse({ name: 'table' }).success).toBe(false);
    expect(s.safeParse({ name: 'TABLE' }).success).toBe(false);
    expect(s.safeParse({ name: 'tables' }).success).toBe(true);
  });

  /**
   * The two failure arms are NOT interchangeable. "That word is reserved" tells
   * an author what to do; a shape mismatch on a well-shaped identifier tells them
   * nothing, which is why the validator reports membership separately.
   */
  it('names the reserved word in the message, rather than reporting a shape mismatch', () => {
    const s = shapeFor({ type: 'string', required: true, kind: 'sql-identifier' });
    const res = s.safeParse({ name: 'select' });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.issues[0]?.message).toContain('reserved SQL word');
  });

  it('reports a shape failure differently from a reserved one', () => {
    const s = shapeFor({ type: 'string', required: true, kind: 'sql-identifier' });
    const res = s.safeParse({ name: 'order items' });
    expect(res.success).toBe(false);
    if (!res.success) {
      // The describe text names the word list too, so the discriminator is the
      // VERB: "is a reserved SQL word" vs "is not a valid sql-identifier".
      expect(res.error.issues[0]?.message).not.toContain('is a reserved SQL word');
      expect(res.error.issues[0]?.message).toContain('is not a valid sql-identifier');
    }
  });

  /**
   * THE REGRESSION THIS BLOCK EXISTS FOR.
   *
   * `nonBlankIfSlugSource` used to REPLACE the derived type with a bare
   * `z.string().regex(/\S/)`, so a constraint declared on the slug source was
   * accepted at registration and enforced nowhere. Asserted on BOTH shapes: the
   * update path had the identical bug, and a rename is exactly when a bad
   * identifier arrives.
   */
  it('composes a named validator with the non-blank slug-source rule', () => {
    const data: DataDeclaration = {
      schema: {
        name: {
          type: 'string',
          required: true,
          kind: 'sql-identifier',
        },
      },
    };
    const slug: SlugPattern = [{ op: 'slugify', field: 'name' }];

    for (const shape of [buildCreateShape(data, slug), buildUpdateShape(data, slug)]) {
      const s = z.object(shape);
      expect(s.safeParse({ name: 'order_items' }).success).toBe(true);
      expect(s.safeParse({ name: 'order items' }).success).toBe(false); // shape survives
      expect(s.safeParse({ name: 'select' }).success).toBe(false); // the word list survives
      expect(s.safeParse({ name: '   ' }).success).toBe(false); // and so does non-blank
    }
  });

  it('leaves a slug source with no declared constraints exactly as it was', () => {
    // The four frozen goldens rest on this: an unflagged string leaf must emit
    // the same schema it emitted before `stringType` existed.
    const s = shapeFor({ type: 'string', required: true }, [{ op: 'slugify', field: 'name' }]);
    expect(s.safeParse({ name: 'anything at all' }).success).toBe(true);
    expect(s.safeParse({ name: '  ' }).success).toBe(false);
  });
});
