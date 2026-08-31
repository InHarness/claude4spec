import { describe, it, expect } from 'vitest';
import { selectedFieldsOf, validateSelect, project } from './project.js';
import { collectionCountKey, selectableFieldsOf } from '../../shared/plugin-host/data-schema.js';
import type { FieldNode } from '../../shared/plugin-host/data-schema.js';

/**
 * 0.2.55 — `<field>Count`, the second name a value collection answers to.
 *
 * The mechanism exists because there was no way to ask a list for a
 * collection's SIZE: `select` names fields, and naming a value collection gets
 * the whole array. A `ui-view` row printing `3p` had to receive every parameter
 * to print it, and a `design-system` row printing a group count had to receive
 * every token with its resolved value per mode.
 *
 * It is a separate NAME rather than a mode of `select` on purpose, and that is
 * the property most worth pinning: counting anything merely ABSENT from
 * `select` would make `select: []` cost a query per collection per row, which
 * `serialization-engine.test.ts` forbids.
 */
const schema: Record<string, FieldNode> = {
  title: { type: 'string', required: true },
  // Embedded: `identity` and no `keyFields`, so it rides on the entity's row.
  params: {
    type: 'collection',
    collection: { kind: 'value', identity: ['name'] },
    listOverview: true,
    item: { type: 'object', fields: { name: { type: 'string' } } },
  },
  body: { type: 'string', contentBearing: true },
};

describe('<field>Count — a value collection\'s second selectable name', () => {
  it('is selectable, and so is the collection itself', () => {
    const names = selectableFieldsOf(schema);

    expect(names).toContain('params');
    expect(names).toContain('paramsCount');
    // Two names for one field, because there are two questions.
    expect(collectionCountKey('params')).toBe('paramsCount');
    expect(() => validateSelect(['paramsCount'], schema)).not.toThrow();
  });

  it('answers the count when named, from the embedded array', () => {
    const row = { slug: 'w', params: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] };

    const out = project(row, ['paramsCount'], schema) as Record<string, unknown>;

    expect(out.paramsCount).toBe(3);
    // The point of the whole exercise: the size WITHOUT the contents.
    expect(out).not.toHaveProperty('params');
  });

  it('gives the array when the field is named, and both when both are', () => {
    const row = { slug: 'w', params: [{ name: 'a' }, { name: 'b' }] };

    expect(project(row, ['params'], schema)).toMatchObject({ params: [{ name: 'a' }, { name: 'b' }] });
    expect(project(row, ['params', 'paramsCount'], schema)).toMatchObject({
      params: [{ name: 'a' }, { name: 'b' }],
      paramsCount: 2,
    });
  });

  it('stays out of the no-select echo, which describes what the record HAS', () => {
    /**
     * The regression this guards. `selectedFieldsOf` derives the no-select echo
     * from `selectableFieldsOf`, which now yields a name that is selectable but
     * is not a field — and with no `select` the record carries the ARRAY, not
     * the count. Echoing `paramsCount` there would advertise a key the record
     * does not have, defeating the one job the echo exists to do: letting a
     * consumer tell a narrow record from an entity that holds little data.
     */
    const echo = selectedFieldsOf(undefined, schema);

    expect(echo).toContain('params');
    expect(echo).not.toContain('paramsCount');
    // Content-bearing fields keep their existing exclusion from this echo.
    expect(echo).not.toContain('body');
  });

  it('echoes the count when the caller DID ask for it — there it is really present', () => {
    expect(selectedFieldsOf(['paramsCount'], schema)).toContain('paramsCount');
  });
});
