import { describe, expect, it } from 'vitest';
import { assertFlagValues, assertKnownFlags, optionalInt, optionalString, parseArgs, paginationFrom, repeatedStrings, requireString, requireStringList } from './args.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CliError } from './errors.js';
import type { CliCommandContribution } from './registry.js';

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

/**
 * 2.1.23 — the argv parser's rule: argv that cannot be READ is a local
 * `INVALID_ARGS`, before any command addresses the server.
 */
describe('INVALID_ARGS for unreadable argv (2.1.23)', () => {
  const code = (fn: () => unknown): string | undefined => {
    try {
      fn();
    } catch (err) {
      return err instanceof CliError ? err.code : 'not-a-cli-error';
    }
    return undefined;
  };

  it('a non-integer --limit / --offset is INVALID_ARGS', () => {
    expect(code(() => paginationFrom(parseArgs(['list-entities', '--limit', 'abc'])))).toBe('INVALID_ARGS');
    expect(code(() => optionalInt(parseArgs(['x', '--offset', '1.5']), 'offset'))).toBe('INVALID_ARGS');
  });

  it('a value flag given without a value is INVALID_ARGS — trailing, or followed by another flag', () => {
    expect(code(() => assertFlagValues(parseArgs(['get-entity', '--type', 'dto', '--slug'])))).toBe('INVALID_ARGS');
    expect(code(() => assertFlagValues(parseArgs(['list-entities', '--project', '--limit', '3'])))).toBe('INVALID_ARGS');
    expect(code(() => optionalString(parseArgs(['agent', 'hi', '--thread']), 'thread'))).toBe('INVALID_ARGS');
    expect(code(() => repeatedStrings(parseArgs(['release-diff', '--paths', 'a', '--paths']), 'paths'))).toBe('INVALID_ARGS');
  });

  it('declared boolean flags and valued flags pass', () => {
    expect(code(() => assertFlagValues(parseArgs(['get-sections', '--anchors', 'a,b', '--include-subtree', '--compact'])))).toBeUndefined();
    expect(code(() => assertFlagValues(parseArgs(['list-entities', '--limit', '3', '--type=dto'])))).toBeUndefined();
  });
});

/**
 * 2.1.53 — the dispatcher boundary: a flag outside the command's list is
 * `INVALID_ARGS`, raised locally before any server call, for every command and
 * every execution mode. `INVALID_ARGUMENT` belongs to the core.
 */
describe('unknown flag → INVALID_ARGS (2.1.53)', () => {
  it('[section:m11dcore] every registered command refuses a flag it does not declare, with INVALID_ARGS', async () => {
    // The bin runs `main()` at import, so the contributions are collected from
    // their modules rather than from its COMMANDS array.
    const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'commands');
    const commands: CliCommandContribution[] = [];
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.startsWith('_'))) {
      const mod = (await import(`./commands/${f.replace(/\.ts$/, '.js')}`)) as Record<string, unknown>;
      for (const v of Object.values(mod)) {
        if (v && typeof v === 'object' && 'executionMode' in v && 'handler' in v) commands.push(v as CliCommandContribution);
      }
    }
    expect(commands.length).toBeGreaterThan(30);
    for (const command of commands) {
      let caught: unknown;
      try {
        assertKnownFlags(parseArgs([command.name, '--definitely-not-a-flag', 'x']), command);
      } catch (err) {
        caught = err;
      }
      expect(caught, command.name).toBeInstanceOf(CliError);
      expect((caught as CliError).code, command.name).toBe('INVALID_ARGS');
      expect((caught as CliError).message, command.name).toContain('--definitely-not-a-flag');
    }
  });

  it('declared and shared flags pass', () => {
    const command = { name: 'list-pages', flags: ['root-id', 'limit'] };
    expect(() =>
      assertKnownFlags(parseArgs(['list-pages', '--root-id', 'pages', '--limit', '3', '--project', 'p', '--compact']), command),
    ).not.toThrow();
  });
});
