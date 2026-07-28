import type { ParsedArgs } from '../args.js';
import { optionalString } from '../args.js';
import { CliError } from '../errors.js';
import { writeOutput } from '../output.js';
import { createPlugin, DEFAULT_TEMPLATE } from '../../../core/plugin-scaffold/create-plugin.js';
import type { CliCommandContribution } from '../registry.js';

/**
 * 0.2.1 M38 — `c4s create-plugin` (mode `scaffold`): bootstraps a new plugin
 * project from a git template into a fresh subdirectory of `process.cwd()`.
 *
 * The first command that resolves no project and no workspace — it runs
 * outside any specification project, so the shared `--project` /
 * `--project-path` / `--workspace` / `--server` selectors do not apply. This
 * file is flag parsing and delegation only; all domain logic lives in the M38
 * core.
 *
 *   c4s create-plugin my-plugin
 *   c4s create-plugin my-plugin --template https://github.com/acme/scaffold --branch v2
 *   c4s create-plugin my-plugin --force --no-install
 */
export async function runCreatePlugin(args: ParsedArgs): Promise<void> {
  const targetDir = args.positional[0];
  if (!targetDir) {
    throw new CliError(
      'INVALID_ARGS',
      '<target-dir> is required',
      'usage: c4s create-plugin <target-dir> [--template <git-url>] [--branch <name>] [--force] [--no-install]',
    );
  }

  const result = createPlugin({
    targetDir,
    template: optionalString(args, 'template') ?? DEFAULT_TEMPLATE,
    branch: optionalString(args, 'branch'),
    force: args.flags.get('force') === true,
    install: args.flags.get('no-install') !== true,
  });

  writeOutput(result, args);
}

export const createPluginCommand: CliCommandContribution = {
  name: 'create-plugin',
  executionMode: 'scaffold',
  errorCodes: [
    'INVALID_ARGS',
    'INVALID_TARGET',
    'TARGET_EXISTS',
    'TEMPLATE_FETCH_FAILED',
    'INSTALL_FAILED',
  ],
  handler: runCreatePlugin,
};
