/**
 * M33 — the bare-specifier map behind the backend `@c4s/plugin-runtime` resolver.
 *
 * Split out from the hook itself (`plugin-runtime-hooks.ts`) because that module
 * runs on Node's LOADER thread, where vitest can't reach it: this half is pure,
 * dependency-free and unit-testable in-process, leaving the subprocess tests to
 * prove only the wiring.
 *
 * The three-valued return is the whole point:
 *   - `undefined` — not ours; the hook delegates untouched (the hot path: every
 *     other import in the process passes through here).
 *   - `string`    — our target URL.
 *   - `null`      — an UNKNOWN `@c4s/plugin-runtime/*` subpath. Reported as
 *     `ERR_PACKAGE_PATH_NOT_EXPORTED` rather than delegated, so a typo surfaces as
 *     "that subpath doesn't exist" instead of Node's baffling "Cannot find package
 *     '@c4s/plugin-runtime'" — which would send the author hunting for a missing
 *     dependency that was never meant to be installed.
 */

/** Resolved absolute URLs of the host's own backend barrels + the host module itself. */
export interface RuntimeTargets {
  /** `@c4s/plugin-runtime` → the backend value barrel (`server/plugin-runtime/index.ts`). */
  runtime: string;
  /** `@c4s/plugin-runtime/ui` → the React-free contract half (`server/plugin-runtime/ui.ts`). */
  ui: string;
  /** The installer module's own URL — used as `parentURL` when re-resolving. */
  self: string;
}

/** The bare alias this host resolves on the backend. */
export const RUNTIME_SPECIFIER = '@c4s/plugin-runtime';
/** The React-free `/ui` contract half. */
export const RUNTIME_UI_SPECIFIER = '@c4s/plugin-runtime/ui';

/**
 * Map a specifier to the host's backend barrel URL.
 *
 * @returns `undefined` to delegate, a URL to resolve, or `null` for an unknown
 * `@c4s/plugin-runtime/*` subpath (caller throws ERR_PACKAGE_PATH_NOT_EXPORTED).
 */
export function mapRuntimeSpecifier(
  specifier: string,
  targets: RuntimeTargets,
): string | null | undefined {
  if (specifier === RUNTIME_SPECIFIER) return targets.runtime;
  if (specifier === RUNTIME_UI_SPECIFIER) return targets.ui;
  if (specifier.startsWith(`${RUNTIME_SPECIFIER}/`)) return null;
  return undefined;
}
