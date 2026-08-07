import type { ParsedArgs } from '../args.js';
import { CliError } from '../errors.js';
import { writeOutput } from '../output.js';
import { delegateGet } from '../delegate.js';
import { SERVER_DELEGATING_CODES, type CliCommandContribution } from '../registry.js';
import type { PluginLoadCode, PluginLoadRecord } from '../../../server/core/plugin-host/loader.js';

/**
 * M11 / M33 — `c4s plugins <list|status|doctor>`.
 *
 * ## 0.2.13 item 25: whose loader is being reported
 *
 * Until this release the three subcommands ran a SECOND plugin loader inside the
 * `c4s` process (`collectPluginDiagnostics`): registry, built-in envelopes,
 * workspace packages, project overlay — the whole bootstrap, a second time. The
 * output was then presented as the project's plugin state.
 *
 * It was not. It was the state the CLI process WOULD have loaded, on this node
 * version, from this cwd, with whatever the package pool looked like at that
 * moment. The server running next to it could have — and after any install,
 * routinely did — a different answer. Two loaders means two answers, and the
 * question these subcommands exist for ("why is my entity type not active?") is
 * exactly the one where being told about the wrong process is worse than not
 * asking: `list` would show a package the server never loaded, and `doctor`
 * would pronounce a host-API verdict on a process that serves nothing.
 *
 * So the loader is gone from this process and the subcommands read
 * `GET /_meta/plugins` — the same route the UI reads, answered by the host that
 * actually mounted the types. The three output shapes are unchanged; only the
 * source of truth is.
 */

/** What `GET /_meta/plugins` answers (`core/plugin-host/cross-cutting.ts`). */
interface PluginsMetaResponse {
  hostApiVersion: string;
  packages: PluginLoadRecord[];
}

/**
 * The codes `doctor` aggregates into `HOST_API_INCOMPATIBLE`.
 *
 * Keyed on the CODE, not on `status === 'incompatible'`, and the distinction is
 * load-bearing. `status` answers a different question — it is `incompatible`
 * only when a migration descriptor exists, i.e. when there is a repair path —
 * so two of the three ways a package can be turned away by the compatibility
 * gate come back `skipped`:
 *
 *   - an `engines.node` miss (`PLUGIN_ENGINE_UNSATISFIED`), and
 *   - a host-API miss with no migration descriptor to offer.
 *
 * Filtering on the status dropped both, which meant `doctor` — the subcommand
 * whose entire job is to explain why a package did not load — stayed silent
 * about a package the loader had refused. `gateManifest` is the one place that
 * decides this, and these are its two codes.
 */
const INCOMPATIBLE_CODES: ReadonlySet<PluginLoadCode> = new Set<PluginLoadCode>([
  'PLUGIN_HOST_API_MISMATCH',
  'PLUGIN_ENGINE_UNSATISFIED',
]);

export async function runPlugins(args: ParsedArgs): Promise<void> {
  const sub = args.positional[0] ?? 'list';
  if (!['list', 'status', 'doctor'].includes(sub)) {
    throw new CliError('INVALID_ARGS', `unknown plugins subcommand '${sub}'`, 'use list | status | doctor');
  }

  const diag = (await delegateGet(args, '/_meta/plugins')) as PluginsMetaResponse;

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
  const incompatible = diag.packages.filter((p) => p.code != null && INCOMPATIBLE_CODES.has(p.code));
  writeOutput(
    {
      hostApiVersion: diag.hostApiVersion,
      incompatible: incompatible.map((p) => ({
        package: p.package,
        tier: p.layer ?? 'base',
        code: p.code ?? null,
        builtAgainst: p.code === 'PLUGIN_HOST_API_MISMATCH' ? p.reason : null,
        // The only field an `engines` miss has to offer — without it such a
        // package would appear in the report as a name and three nulls.
        reason: p.reason ?? null,
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
      `${incompatible.length} package(s) the host refused to load: ${names}`,
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

export const pluginsCommand: CliCommandContribution = {
  name: 'plugins',
  executionMode: 'server-delegating',
  errorCodes: [...SERVER_DELEGATING_CODES, 'INVALID_ARGS', 'HOST_API_INCOMPATIBLE'],
  handler: runPlugins,
};
