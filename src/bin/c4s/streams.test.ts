import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runWithStreamDiscipline } from './streams.js';
import { CliError, codeToExit } from './errors.js';
import { writeOutput } from './output.js';
import { parseArgs } from './args.js';

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

const text = (spy: ReturnType<typeof vi.spyOn>): string =>
  spy.mock.calls.map((call: unknown[]) => String(call[0])).join('');

/** A command that writes on both streams — directly and through `console.*` — and then fails. */
async function failingCommand(): Promise<void> {
  console.log('log line on stdout');
  process.stdout.write('{"partial": true}\n');
  console.warn('warning before the failure');
  process.stderr.write('progress: step 1\n');
  throw new CliError('ENTITY_NOT_FOUND', "entity 'nope' not found", 'check the slug');
}

describe('runWithStreamDiscipline — error path', () => {
  it('[ac:ac-blad-komendy-zostawia-stdout-pusty] a failing command leaves stdout empty, even after writing to it', async () => {
    const exit = await runWithStreamDiscipline(failingCommand);

    expect(exit).toBe(codeToExit('ENTITY_NOT_FOUND'));
    expect(exit).toBeGreaterThan(0);
    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(text(stdoutSpy)).toBe('');
  });

  it('[ac:ac-blad-komendy-zostawia-stdout-pusty] a non-CLI error (generic exit) leaves stdout empty too', async () => {
    const exit = await runWithStreamDiscipline(async () => {
      writeOutput({ a: 1 }, parseArgs(['list-tags']));
      throw new Error('boom');
    });

    expect(exit).toBe(1);
    expect(text(stdoutSpy)).toBe('');
  });

  it('[ac:ac-blad-komendy-zostawia-na-stderr-wylac] a failing command leaves on stderr only the error envelope, with no log line before or after it', async () => {
    await runWithStreamDiscipline(failingCommand);

    const stderr = text(stderrSpy);
    // The whole of stderr parses as one JSON document — nothing before, nothing after.
    expect(() => JSON.parse(stderr)).not.toThrow();
    expect(JSON.parse(stderr)).toEqual({
      error: { code: 'ENTITY_NOT_FOUND', message: "entity 'nope' not found", hint: 'check the slug' },
    });
    expect(stderr).not.toContain('warning before the failure');
    expect(stderr).not.toContain('progress: step 1');
    expect(stderrSpy).toHaveBeenCalledTimes(1);
  });

  it('[ac:ac-blad-komendy-zostawia-na-stderr-wylac] a log line written before an unexpected error does not reach stderr ahead of the envelope', async () => {
    await runWithStreamDiscipline(async () => {
      console.error('library diagnostic');
      throw new Error('boom');
    });

    const stderr = text(stderrSpy);
    expect(JSON.parse(stderr)).toEqual({ error: { code: 'UNKNOWN_COMMAND', message: 'boom' } });
    expect(stderr).not.toContain('library diagnostic');
  });
});

describe('runWithStreamDiscipline — success path', () => {
  it('puts the payload on stdout only and exits 0', async () => {
    const exit = await runWithStreamDiscipline(async () => {
      writeOutput({ a: 1 }, parseArgs(['list-tags']));
    });

    expect(exit).toBe(0);
    expect(text(stdoutSpy)).toBe(JSON.stringify({ a: 1 }, null, 2) + '\n');
    expect(text(stderrSpy)).toBe('');
  });

  it('passes a human notice written to stderr after the payload, never into stdout', async () => {
    await runWithStreamDiscipline(async () => {
      process.stdout.write('content\n');
      process.stderr.write('content was truncated\n');
    });

    expect(text(stdoutSpy)).toBe('content\n');
    expect(text(stderrSpy)).toBe('content was truncated\n');
  });

  it('restores the real stream writers once the run is over', async () => {
    const before = process.stdout.write;
    await runWithStreamDiscipline(failingCommand);
    expect(process.stdout.write).toBe(before);
  });
});
