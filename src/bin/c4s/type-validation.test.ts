import { describe, expect, it } from 'vitest';
import { normalizeEntityType, normalizeViewKind } from './type-validation.js';
import { CliError } from './errors.js';

describe('normalizeEntityType', () => {
  it("normalizes the spec-alias 'database_table' to canonical 'database-table'", () => {
    expect(normalizeEntityType('database_table')).toBe('database-table');
  });

  it('passes canonical types through unchanged', () => {
    expect(normalizeEntityType('endpoint')).toBe('endpoint');
    expect(normalizeEntityType('dto')).toBe('dto');
    expect(normalizeEntityType('database-table')).toBe('database-table');
    expect(normalizeEntityType('ui-view')).toBe('ui-view');
    expect(normalizeEntityType('ac')).toBe('ac');
  });

  it("throws CliError 'INVALID_TYPE' with a hint for unknown types", () => {
    let caught: unknown;
    try {
      normalizeEntityType('widget');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(CliError);
    const cliErr = caught as CliError;
    expect(cliErr.code).toBe('INVALID_TYPE');
    expect(cliErr.message).toContain("unknown entity type 'widget'");
    expect(cliErr.hint).toContain('c4s catalog');
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
