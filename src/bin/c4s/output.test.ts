import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeOutput, writeError } from './output.js';
import type { ParsedArgs } from './args.js';
import { CliError } from './errors.js';

function makeArgs(overrides: Partial<ParsedArgs> = {}): ParsedArgs {
  return {
    command: null,
    positional: [],
    flags: new Map(),
    format: 'json',
    compact: false,
    sortKeys: false,
    ...overrides,
  };
}

let stdoutSpy: ReturnType<typeof vi.spyOn>;
let stderrSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  stdoutSpy.mockRestore();
  stderrSpy.mockRestore();
});

function stdoutText(): string {
  return stdoutSpy.mock.calls.map((call: unknown[]) => String(call[0])).join('');
}

function stderrText(): string {
  return stderrSpy.mock.calls.map((call: unknown[]) => String(call[0])).join('');
}

describe('writeOutput (json format)', () => {
  it('pretty-prints JSON by default with a trailing newline', () => {
    writeOutput({ a: 1 }, makeArgs());
    expect(stdoutText()).toBe(JSON.stringify({ a: 1 }, null, 2) + '\n');
  });

  it('emits single-line JSON when compact', () => {
    writeOutput({ a: 1, b: [1, 2] }, makeArgs({ compact: true }));
    expect(stdoutText()).toBe('{"a":1,"b":[1,2]}\n');
  });

  it('sorts object keys recursively with sortKeys but leaves array order untouched', () => {
    const data = {
      zebra: 1,
      alpha: { delta: 4, charlie: 3 },
      list: [3, 1, 2],
      items: [{ z: 1, a: 2 }],
    };
    writeOutput(data, makeArgs({ compact: true, sortKeys: true }));
    expect(stdoutText()).toBe(
      '{"alpha":{"charlie":3,"delta":4},"items":[{"a":2,"z":1}],"list":[3,1,2],"zebra":1}\n'
    );
  });
});

describe('writeOutput (text format)', () => {
  it('renders scalars and key-value pairs', () => {
    writeOutput({ name: 'foo', count: 2, ok: true }, makeArgs({ format: 'text' }));
    expect(stdoutText()).toBe('name: foo\ncount: 2\nok: true\n');
  });

  it('renders nested structures with indices and indentation', () => {
    writeOutput(
      { items: ['a', 'b'], meta: { total: 2 } },
      makeArgs({ format: 'text' })
    );
    // Nested values are rendered inline after the key, with per-level indentation
    // applied by the recursive renderer.
    expect(stdoutText()).toBe('items:   [0] a\n  [1] b\nmeta:   total: 2\n');
  });

  it('renders null, empty arrays and empty objects with placeholders', () => {
    writeOutput(null, makeArgs({ format: 'text' }));
    writeOutput([], makeArgs({ format: 'text' }));
    writeOutput({}, makeArgs({ format: 'text' }));
    expect(stdoutText()).toBe('null\n(empty)\n{}\n');
  });
});

describe('writeError', () => {
  it('prints the error envelope with code, message and hint to stderr', () => {
    writeError(new CliError('INVALID_TYPE', 'unknown entity type', 'run c4s catalog'));
    const parsed = JSON.parse(stderrText());
    expect(parsed).toEqual({
      error: {
        code: 'INVALID_TYPE',
        message: 'unknown entity type',
        hint: 'run c4s catalog',
      },
    });
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it('omits the hint key entirely when the error has no hint', () => {
    writeError(new CliError('TIMEOUT', 'took too long'));
    const parsed = JSON.parse(stderrText());
    expect(parsed).toEqual({ error: { code: 'TIMEOUT', message: 'took too long' } });
    expect('hint' in parsed.error).toBe(false);
  });
});
