import { describe, expect, it } from 'vitest';
import { normalizeEntityType, normalizeViewKind } from './type-validation.js';
import { CliError } from './errors.js';

describe('normalizeEntityType', () => {
  it('passes any kebab-case type through unchanged', () => {
    for (const t of ['endpoint', 'dto', 'database-table', 'ui-view', 'ac', 'design-system']) {
      expect(normalizeEntityType(t)).toBe(t);
    }
  });

  /**
   * 0.2.11 — the inverse of the old assertion, and the point of the change.
   * `widget` used to throw because it was not one of five literals; a
   * plugin-contributed type is exactly as unknown to this function as `widget`
   * was, so rejecting it here made all 13 commands that call this unusable for
   * plugin types. Existence is now the discovery core's question, answered with
   * the project's real type list.
   */
  it('accepts a type it has never heard of, leaving existence to the core', () => {
    expect(normalizeEntityType('widget')).toBe('widget');
    expect(normalizeEntityType('spreadsheet')).toBe('spreadsheet');
  });

  it("throws CliError 'INVALID_TYPE' for a value that is not a type id at all", () => {
    // Including the underscore spellings that used to be aliased: a type id is
    // kebab-case, so these are malformed rather than alternative.
    for (const bad of ['database_table', 'ui_view', 'Endpoint', 'has space', '-leading', '']) {
      let caught: unknown;
      try {
        normalizeEntityType(bad);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(CliError);
      const cliErr = caught as CliError;
      expect(cliErr.code).toBe('INVALID_TYPE');
      expect(cliErr.message).toContain(`invalid entity type '${bad}'`);
      expect(cliErr.hint).toContain('c4s catalog');
    }
  });
});

describe('normalizeViewKind', () => {
  it('accepts all valid view kinds', () => {
    for (const kind of [
      'inline_mention',
      'single_element',
      'element_list_item',
      'tagged_list_item',
      'detail',
    ] as const) {
      expect(normalizeViewKind(kind)).toBe(kind);
    }
  });

  it("throws CliError 'INVALID_VIEW' with a hint listing allowed kinds for invalid input", () => {
    let caught: unknown;
    try {
      normalizeViewKind('summary');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(CliError);
    const cliErr = caught as CliError;
    expect(cliErr.code).toBe('INVALID_VIEW');
    expect(cliErr.message).toContain("unknown view 'summary'");
    expect(cliErr.hint).toContain('inline_mention');
  });
});
