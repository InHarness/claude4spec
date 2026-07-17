/**
 * M33 — installs the host-owned resolver for the bare `@c4s/plugin-runtime` alias.
 *
 * Why this exists: a plugin's backend code is told to build its custom MCP server
 * through the C4S facade (`createMcpServer` / `mcpTool` re-exported from
 * `@c4s/plugin-runtime`) rather than naming the vendor. Types for that bare alias
 * come from the ambient `declare module` (`plugin-types/ambient.d.ts`), so an
 * external plugin COMPILES — but until this resolver existed nothing bound the alias
 * in Node, and its built `dist/index.js` died at `await import()` with
 * `ERR_MODULE_NOT_FOUND`. That left external authors naming the vendor directly,
 * reintroducing exactly what the facade removes: ERESOLVE peer conflicts, two vendor
 * copies in one process, and dev↔prod divergence.
 *
 * The hook itself is `plugin-runtime-hooks.ts` (loader thread); this half runs on the
 * host thread and only wires it up. Both `.js` URLs below are resolved relative to
 * THIS module, which sits at the same depth in the `src/` and `dist/` trees — so the
 * one expression covers dev (tsx maps `.js` → `.ts`) and prod (the `.js` is real)
 * with no mode flag.
 *
 * The values are process-global, so the resolver is too: per-project state (db,
 * services) reaches a plugin through `MountContext`, never through this alias.
 */

// NOT `import { register } from 'node:module'`: a named import of a builtin export
// that doesn't exist is a LINK-time error, which would crash the whole module graph
// on node 20.0–20.5 before any guard could run — defeating the graceful degradation
// below. `engines.node` is only `>=20`, while `module.register` landed in 20.6.
import * as nodeModule from 'node:module';
import type { RuntimeTargets } from './plugin-runtime-specifiers.js';

/** `module.register`'s shape — only what we call. */
type RegisterFn = (specifier: string | URL, options?: { parentURL?: string; data?: unknown }) => unknown;

/**
 * Latch: `null` = not attempted. Every plugin-loading path calls the installer
 * (there are several entry points, and projects load lazily), but a process needs
 * exactly one registration — and a failed attempt must not be retried per project.
 */
let installed: boolean | null = null;

/** The `.js` spelling is intentional in both trees — see the module docblock. */
function buildTargets(): RuntimeTargets {
  return {
    runtime: new URL('../../plugin-runtime/index.js', import.meta.url).href,
    ui: new URL('../../plugin-runtime/ui.js', import.meta.url).href,
    self: import.meta.url,
  };
}

/**
 * Install the resolver once per process. Idempotent and never throws: a host that
 * can't register hooks must still load plugins that don't use the bare alias.
 *
 * @param register seam for tests; defaults to `module.register`.
 * @returns whether the resolver is active.
 */
export function installPluginRuntimeResolver(
  register: unknown = (nodeModule as { register?: RegisterFn }).register,
): boolean {
  if (installed !== null) return installed;
  installed = false;

  if (typeof register !== 'function') {
    console.warn(
      `[plugin-runtime] node ${process.versions.node} has no module.register (needs >=20.6) — ` +
        `backend imports of "@c4s/plugin-runtime" will not resolve; plugins can import ` +
        `"@inharness-ai/claude4spec/plugin-runtime" instead`,
    );
    return installed;
  }

  try {
    (register as RegisterFn)(new URL('./plugin-runtime-hooks.js', import.meta.url).href, {
      parentURL: import.meta.url,
      data: buildTargets(),
    });
    installed = true;
  } catch (err) {
    console.warn(
      `[plugin-runtime] could not install the "@c4s/plugin-runtime" resolver: ` +
        `${(err as Error).message} — continuing without it`,
    );
  }
  return installed;
}

/** Test-only: drop the once-per-process latch. */
export function resetPluginRuntimeResolverForTests(): void {
  installed = null;
}
