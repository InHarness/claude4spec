/**
 * Item 27's proof: the GENERATED CRUD schemas against the hand-written ones
 * they replace, field for field, for all six shipped types.
 *
 * Same instrument as tier A's `projection.golden.test.ts`. The retired schemas
 * are still in the tree (tier K deletes them), so this can compare the two
 * descriptions directly rather than freezing a snapshot of one — which is the
 * whole point: a snapshot would only say the generator is stable, and what
 * needs saying is that it agrees with six files of hand-maintained zod.
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
import { uiViewData } from '../../../shared/entities/ui-view/schema.js';
import { designSystemData } from '../../../shared/entities/design-system/schema.js';
import { acCreateSchema, acUpdateSchema } from '../../entities/ac/crud-schemas.js';
import { diagramCreateSchema, diagramUpdateSchema } from '../../entities/diagram/crud-schemas.js';
import { uiViewCreateSchema, uiViewUpdateSchema } from '../../entities/ui-view/crud-schemas.js';
import {
  designSystemCreateSchema,
  designSystemUpdateSchema,
} from '../../entities/design-system/crud-schemas.js';
import type { DataDeclaration } from '../../../shared/plugin-host/data-schema.js';

const keys = (shape: ZodRawShape): string[] => Object.keys(shape).sort();

/** Fields a payload MUST carry — the half of the contract a caller can violate. */
function requiredKeys(shape: ZodRawShape): string[] {
  const json = z.toJSONSchema(z.object(shape), { io: 'input' }) as { required?: string[] };
  return (json.required ?? []).slice().sort();
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
 * The four in-repo types. `dto` and `endpoint` live in the plugin workspace and
 * are covered by that package's own suite — importing across the workspace
 * boundary here is exactly the coupling the envelope exists to prevent.
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
     * `firstSourceIdentifier` is `transientInput` — declared so the slug
     * pattern may read it, host-derived from `source`, and therefore on the
     * create shape by the same rule that puts `caption` there. There is no flag
     * for "transient AND host-derived"; its `description` says so instead, and
     * the gap is filed as a `missing` patch.
     */
    createAdds: ['firstSourceIdentifier'],
    updateAdds: [],
  },
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

  it('a design-system token value accepts a literal, which its retired record node did not', () => {
    // The regression this release would have shipped: `record<string,string>`
    // declared only the composite arm, so the commonest token in any design
    // system — a colour — failed its own create schema.
    const create = z.object(buildCreateShape(designSystemData));
    const withLiteral = {
      name: 'Brand',
      groups: [{ name: 'color', tier: 'primitive', tokens: [{ name: 'brand', type: 'color', value: '#2563eb' }] }],
    };
    expect(create.safeParse(withLiteral).success).toBe(true);

    const withComposite = {
      name: 'Brand',
      groups: [
        {
          name: 'type',
          tier: 'semantic',
          tokens: [{ name: 'body', type: 'typography', value: { fontSize: '16px', lineHeight: '1.5' } }],
        },
      ],
    };
    expect(create.safeParse(withComposite).success).toBe(true);
  });

  it('rejects an unknown enum value rather than coercing it', () => {
    // `diagram.format` is the case the brief names: the retired read path
    // mapped everything that was not `d2` onto `mermaid`, silently.
    const create = z.object(buildCreateShape(diagramData));
    expect(create.safeParse({ source: 'graph TD', format: 'graphviz' }).success).toBe(false);
    expect(create.safeParse({ source: 'graph TD', format: 'd2' }).success).toBe(true);
  });

  it('admits null on update only for a clearable field', () => {
    const update = z.object(buildUpdateShape(uiViewData));
    // `designSystemSlug` is `clearable` — null means detach.
    expect(update.safeParse({ designSystemSlug: null }).success).toBe(true);
    // `name` is not, so null is a type error and not a way to blank the row.
    expect(update.safeParse({ name: null }).success).toBe(false);
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
