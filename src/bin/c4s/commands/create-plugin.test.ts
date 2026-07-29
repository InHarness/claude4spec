import { describe, expect, it, vi } from 'vitest';
import { parseArgs } from '../args.js';
import { CliError } from '../errors.js';

const createPlugin = vi.hoisted(() => vi.fn());
vi.mock('../../../core/plugin-scaffold/create-plugin.js', () => ({
  DEFAULT_TEMPLATE: 'https://github.com/InHarness/c4s-plugin-scaffold',
  createPlugin,
}));

const { createPluginCommand, runCreatePlugin } = await import('./create-plugin.js');

/**
 * The contribution parses flags and delegates — nothing else. These assert the
 * flag → core-input mapping (and that the positional survives boolean flags),
 * with the M38 core stubbed out.
 */
function run(argv: string[]) {
  createPlugin.mockReset();
  createPlugin.mockReturnValue({
    targetDir: '/tmp/x',
    template: 't',
    branch: 'main',
    filesWritten: 1,
    installed: false,
  });
  const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  return runCreatePlugin(parseArgs(argv)).finally(() => write.mockRestore());
}

describe('c4s create-plugin', () => {
  it('declares the scaffold execution mode and its error codes', () => {
    expect(createPluginCommand.executionMode).toBe('scaffold');
    expect(createPluginCommand.errorCodes).toEqual([
      'INVALID_ARGS',
      'INVALID_TARGET',
      'TARGET_EXISTS',
      'TEMPLATE_FETCH_FAILED',
      'SCAFFOLD_WRITE_FAILED',
      'INSTALL_FAILED',
    ]);
  });

  it('defaults template, branch, force and install', async () => {
    await run(['create-plugin', 'my-plugin']);
    expect(createPlugin).toHaveBeenCalledWith({
      targetDir: 'my-plugin',
      template: 'https://github.com/InHarness/c4s-plugin-scaffold',
      branch: undefined,
      force: false,
      install: true,
    });
  });

  it('maps every flag onto the core input', async () => {
    await run([
      'create-plugin',
      'my-plugin',
      '--template',
      'https://example.com/tpl.git',
      '--branch',
      'v2',
      '--force',
      '--no-install',
    ]);
    expect(createPlugin).toHaveBeenCalledWith({
      targetDir: 'my-plugin',
      template: 'https://example.com/tpl.git',
      branch: 'v2',
      force: true,
      install: false,
    });
  });

  it('keeps the positional when a boolean flag precedes it', async () => {
    await run(['create-plugin', '--force', 'my-plugin']);
    expect(createPlugin).toHaveBeenCalledWith(expect.objectContaining({ targetDir: 'my-plugin' }));
  });

  it('rejects a valueless --template / --branch instead of silently defaulting', async () => {
    // `parseArgs` turns a trailing `--template` into boolean `true`; falling
    // back to the default scaffold repo there would scaffold the wrong starter
    // and report success.
    for (const argv of [
      ['create-plugin', 'p', '--template'],
      ['create-plugin', 'p', '--branch'],
      ['create-plugin', 'p', '--template', '--force'],
    ]) {
      await expect(run(argv)).rejects.toMatchObject({ code: 'INVALID_ARGS' });
      expect(createPlugin).not.toHaveBeenCalled();
    }
  });

  it('rejects a missing <target-dir> as INVALID_ARGS, without calling the core', async () => {
    await expect(run(['create-plugin'])).rejects.toMatchObject({ code: 'INVALID_ARGS' });
    await expect(run(['create-plugin'])).rejects.toBeInstanceOf(CliError);
    expect(createPlugin).not.toHaveBeenCalled();
  });
});
