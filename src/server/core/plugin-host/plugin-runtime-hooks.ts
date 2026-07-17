/**
 * M33 — ESM resolve hook backing the bare `@c4s/plugin-runtime` alias on the backend.
 *
 * Runs on Node's LOADER thread (registered by `plugin-runtime-resolver.ts` via
 * `module.register`), so it is deliberately thin: only the pure specifier map is
 * imported, and `initialize` receives the target URLs as plain data (the loader
 * thread cannot share live objects with the host thread).
 *
 * Two properties this hook must preserve — both verified by the subprocess tests
 * in `plugin-runtime-resolver.subprocess.test.ts`:
 *
 * 1. DELEGATE, NEVER SHORT-CIRCUIT. The target URL we hand to `nextResolve` is
 *    always spelled `.js`, but under `tsx` (dev) that file doesn't exist on disk —
 *    the real module is `.ts`. Hook chains run last-registered-first, and we
 *    register at bootstrap while tsx registers at process start, so `nextResolve`
 *    hands off to tsx, which maps `.js` → `.ts`. Returning `{shortCircuit: true}`
 *    would skip tsx and make Node try to load a file that isn't there.
 *
 * 2. ONE INSTANCE. We resolve to the SAME url the host itself imports (it reaches
 *    the barrel by relative path), so Node's per-URL ESM cache hands the plugin the
 *    host's live module — not a second copy with its own `HOST_API_VERSION`. This is
 *    the backend counterpart of the frontend's import-map singleton guarantee.
 */

import {
  mapRuntimeSpecifier,
  RUNTIME_SPECIFIER,
  type RuntimeTargets,
} from './plugin-runtime-specifiers.js';

/** Minimal shape of Node's resolve-hook context (only what this hook touches). */
interface ResolveContext {
  parentURL?: string;
  conditions?: string[];
  importAttributes?: Record<string, string>;
}

type NextResolve = (specifier: string, context: ResolveContext) => unknown;

let targets: RuntimeTargets | null = null;

/** Receives the `data` passed to `module.register` (host thread → loader thread). */
export function initialize(data: RuntimeTargets): void {
  targets = data;
}

export function resolve(specifier: string, context: ResolveContext, nextResolve: NextResolve) {
  // Not initialized (defensive) or not our specifier → delegate untouched. Every
  // import in the process passes through here, so this stays a string compare.
  if (targets === null) return nextResolve(specifier, context);

  const target = mapRuntimeSpecifier(specifier, targets);
  if (target === undefined) return nextResolve(specifier, context);

  if (target === null) {
    const subpath = `.${specifier.slice(RUNTIME_SPECIFIER.length)}`;
    const err = new Error(
      `Package subpath '${subpath}' is not exported by '${RUNTIME_SPECIFIER}' ` +
        `(this host resolves only '${RUNTIME_SPECIFIER}' and '${RUNTIME_SPECIFIER}/ui')`,
    ) as Error & { code: string };
    err.code = 'ERR_PACKAGE_PATH_NOT_EXPORTED';
    throw err;
  }

  // `parentURL` is pinned to the host module rather than left as the importing
  // plugin's own file: resolution of the host's barrel must not depend on where the
  // plugin happens to live (typically deep inside `node_modules`).
  return nextResolve(target, { ...context, parentURL: targets.self });
}
