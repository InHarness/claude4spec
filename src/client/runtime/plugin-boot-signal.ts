/**
 * M33 — the plugins-ready signal of the first frontend boot, as a leaf module.
 *
 * The boot deliberately does not block first paint, which leaves a window where
 * a plugin-contributed route or envelope type does not exist yet. Readers (the
 * router's not-found component, the broken-references bar) consult this signal
 * to tell "still loading" apart from "really missing". Resolves (never rejects)
 * once the boot has settled either way.
 *
 * It lives apart from `boot-plugins.ts` on purpose: the loader's import graph
 * reaches `shared-runtime.ts`, which publishes the whole host UI kit
 * (`host-ui-kit/index.ts` → `registry.ts`). An editor-side reader importing the
 * signal through the loader closed a cycle back into the kit — entering the graph
 * at `DocEditor` evaluated the catalog registry before `DocEditor` was defined.
 * This module imports nothing, so a reader of the signal pulls in no runtime.
 */

let bootSettled = false;
let resolveBoot: (() => void) | undefined;

/** Resolves once the first `bootFrontendPlugins` call has settled. */
export const frontendPluginsBooted: Promise<void> = new Promise((resolve) => {
  resolveBoot = resolve;
});

/** True until the first `bootFrontendPlugins` call settles. */
export function pluginBootPending(): boolean {
  return !bootSettled;
}

/** Ends the boot window — called by the loader only, success or failure. */
export function settlePluginBoot(): void {
  bootSettled = true;
  resolveBoot?.();
}
