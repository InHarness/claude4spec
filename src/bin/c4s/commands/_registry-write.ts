import { CliError } from '../errors.js';
import { RegisterHomeError, RegistryMigrationPendingError } from '../../../server/workspace/registry.js';
import { WorkspaceSelectionError } from '../../../server/workspace/start-selection.js';
import { TrustPluginsError } from '../../../server/workspace/trust-plugins.js';

/**
 * M31 `m31cli01` — the refusals of the three `registry-write` commands
 * (`trust-plugins`, `register-home`, `confirm-skill-uses`) as CLI errors. Every
 * one leaves through the M11 envelope with the generic exit status of its code
 * (`codeToExit`, no entry of their own); the cause travels in `error.code`.
 * The rules themselves live in the M31 core — this maps, it never decides.
 * Returns null for anything that is not one of these refusals.
 */
export function registryWriteCliError(err: unknown): CliError | null {
  if (err instanceof RegistryMigrationPendingError) {
    return new CliError(
      'REGISTRY_MIGRATION_PENDING',
      err.message,
      'start the claude4spec server once (`npx @inharness-ai/claude4spec`) — it migrates the registry — then re-run this command',
      { steps: [{ action: 'start-server', command: 'npx @inharness-ai/claude4spec' }, { action: 'rerun' }] },
    );
  }
  if (err instanceof TrustPluginsError) {
    return new CliError(
      err.code,
      err.message,
      err.hint,
      err.code === 'PROJECT_NOT_IN_WORKSPACE_FILE'
        ? { steps: [{ action: 'add-project', where: 'server UI or workspace.json' }, { action: 'rerun' }] }
        : undefined,
    );
  }
  if (err instanceof RegisterHomeError) {
    return new CliError(
      err.code,
      err.message,
      err.hint,
      err.code === 'WORKSPACE_FILE_MISSING'
        ? {
            steps: [
              { action: 'start-server', command: 'npx @inharness-ai/claude4spec --cwd <dir>' },
              { action: 'or-add-workspace-description', where: '<dir>/.claude4spec/workspace.json' },
            ],
          }
        : undefined,
    );
  }
  if (err instanceof WorkspaceSelectionError) return new CliError(err.code, err.message, err.hint);
  return null;
}
