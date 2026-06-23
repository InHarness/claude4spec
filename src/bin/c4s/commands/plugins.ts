import type { ParsedArgs } from '../args.js';
import { CliError } from '../errors.js';
import { writeOutput } from '../output.js';
import { collectPluginDiagnostics } from '../../../server/core/plugin-host/cli-plugins.js';
import { WorkspaceResolveError } from '../../../core/workspace/resolve.js';
import type { PluginLoadRecord } from '../../../server/core/plugin-host/loader.js';

/**
 * M11 / M33 phase 3 — `c4s plugins <list|status|doctor>`. Reads the loader state
 * (base ∪ trusted overlay) without a running server, mirroring
 * `GET /api/_meta/plugins`. `doctor` is the only subcommand with a non-zero
 * exit: `HOST_API_INCOMPATIBLE` when any package was built against an
 * incompatible MAJOR Host API.
 */
export async function runPlugins(args: ParsedArgs): Promise<void> {
  const sub = args.positional[0] ?? 'list';
  if (!['list', 'status', 'doctor'].includes(sub)) {
    throw new CliError('INVALID_ARGS', `unknown plugins subcommand '${sub}'`, 'use list | status | doctor');
  }

  let diag;
  try {
    diag = await collectPluginDiagnostics({ project: args.project, workspace: args.workspace });
  } catch (err) {
    // Map workspace resolution errors onto the CLI error surface (exit codes).
    if (err instanceof WorkspaceResolveError) {
      throw new CliError(err.code, err.message, err.hint);
    }
    throw err;
  }

  if (sub === 'list') {
    writeOutput(
      {
        hostApiVersion: diag.hostApiVersion,
        packages: diag.packages.map((p) => ({
          package: p.package,
          tier: p.layer ?? 'base',
          version: p.manifestVersion ?? null,
          contributedTypes: p.contributedTypes ?? [],
        })),
      },
      args,
    );
    return;
  }

  if (sub === 'status') {
    writeOutput(
      {
        hostApiVersion: diag.hostApiVersion,
        packages: diag.packages.map((p) => ({
          package: p.package,
          tier: p.layer ?? 'base',
          status: p.status,
          code: p.code ?? null,
          reason: p.reason ?? null,
          hostApiVersion: diag.hostApiVersion,
          trust: trustLabel(p),
        })),
      },
      args,
    );
    return;
  }

  // doctor — emit the repair path for every incompatible package, then exit
  // non-zero if any exist (report on stdout first, error summary on stderr).
  const incompatible = diag.packages.filter((p) => p.status === 'incompatible');
  writeOutput(
    {
      hostApiVersion: diag.hostApiVersion,
      incompatible: incompatible.map((p) => ({
        package: p.package,
        tier: p.layer ?? 'base',
        builtAgainst: p.code === 'PLUGIN_HOST_API_MISMATCH' ? p.reason : null,
        migration: p.migration ?? null,
      })),
      ok: incompatible.length === 0,
    },
    args,
  );
  if (incompatible.length > 0) {
    const names = incompatible.map((p) => p.package).join(', ');
    throw new CliError(
      'HOST_API_INCOMPATIBLE',
      `${incompatible.length} package(s) built against an incompatible major Host API: ${names}`,
      `target hostApiVersion "${diag.hostApiVersion}" — see the migration descriptors above`,
    );
  }
}

/** Overlay trust state for `status` output; base packages are always trusted. */
function trustLabel(p: PluginLoadRecord): string {
  if ((p.layer ?? 'base') === 'base') return 'trusted';
  if (p.code === 'PLUGIN_PROJECT_UNTRUSTED') return 'untrusted-skipped';
  return p.trust ?? 'trusted';
}
