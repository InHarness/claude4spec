import { describe, expect, it } from 'vitest';
import { parseArgs, requireString, requireStringList } from './args.js';
import { CliError } from './errors.js';

describe('parseArgs', () => {
  it('parses command, positionals and defaults', () => {
    const args = parseArgs(['detail', 'endpoint', 'get-users']);
    expect(args.command).toBe('detail');
    expect(args.positional).toEqual(['endpoint', 'get-users']);
    expect(args.format).toBe('json');
    expect(args.compact).toBe(false);
    expect(args.sortKeys).toBe(false);
  });

  it('parses --format=json (equals form) and --compact boolean', () => {
    const args = parseArgs(['catalog', '--format=json', '--compact']);
    expect(args.format).toBe('json');
    expect(args.compact).toBe(true);
    expect(args.flags.get('compact')).toBe(true);
  });

  it("throws CliError with code 'INVALID_ARGS' for --format yaml", () => {
    let caught: unknown;
    try {
      parseArgs(['catalog', '--format', 'yaml']);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(CliError);
    expect((caught as CliError).code).toBe('INVALID_ARGS');
  });

  it('consumes the next token as a value flag via lookahead', () => {
    const args = parseArgs(['catalog', '--project', 'foo']);
    expect(args.project).toBe('foo');
    expect(args.flags.get('project')).toBe('foo');
    // 'foo' was consumed as the flag value, not a positional
    expect(args.positional).toEqual([]);
  });

  it('does not consume a following --flag as a value (project stays boolean true)', () => {
    const args = parseArgs(['catalog', '--project', '--compact']);
    expect(args.flags.get('project')).toBe(true);
    expect(args.project).toBeUndefined();
    expect(args.compact).toBe(true);
  });
});

describe('requireString', () => {
  it('returns the string value when present', () => {
    const args = parseArgs(['cmd', '--slug', 'my-slug']);
    expect(requireString(args, 'slug')).toBe('my-slug');
  });

  it("throws CliError 'INVALID_ARGS' when the flag is missing or boolean", () => {
    const missing = parseArgs(['cmd']);
    expect(() => requireString(missing, 'slug')).toThrowError(CliError);
    try {
      requireString(missing, 'slug');
    } catch (err) {
      expect((err as CliError).code).toBe('INVALID_ARGS');
      expect((err as CliError).message).toContain('--slug');
    }

    // boolean flag (no value consumed) also fails the string requirement
    const boolOnly = parseArgs(['cmd', '--slug']);
    expect(() => requireString(boolOnly, 'slug')).toThrowError(CliError);
  });
});

describe('requireStringList', () => {
  it('splits on commas, trims whitespace and drops empty segments', () => {
    const args = parseArgs(['cmd', '--slugs', ' a, b ,,c , ']);
    expect(requireStringList(args, 'slugs')).toEqual(['a', 'b', 'c']);
  });

  it("throws CliError 'INVALID_ARGS' when the flag is missing", () => {
    const args = parseArgs(['cmd']);
    expect(() => requireStringList(args, 'slugs')).toThrowError(CliError);
  });
});
