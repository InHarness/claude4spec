import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assertKnownFlags, parseArgs } from '../../../src/bin/c4s/args.js';
import { CliError } from '../../../src/bin/c4s/errors.js';
import type { CliCommandContribution } from '../../../src/bin/c4s/registry.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * 2.1.53 — every `c4s` command declares its flags, and the dispatcher refuses
 * any other one with `INVALID_ARGS`, locally, whatever the execution mode.
 */
describe('c4s — unknown flag is INVALID_ARGS for every command (2.1.53)', () => {
  it('[section:m11dcore] every registered command refuses a flag it does not declare, with INVALID_ARGS', async () => {
    // The bin runs `main()` at import, so the contributions are collected from
    // their modules rather than from its COMMANDS array.
    const dir = path.join(REPO_ROOT, 'src/bin/c4s/commands');
    const commands: CliCommandContribution[] = [];
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.startsWith('_'))) {
      const mod = (await import(pathToFileURL(path.join(dir, f)).href)) as Record<string, unknown>;
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
});
