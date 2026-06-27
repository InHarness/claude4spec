/**
 * Ambient binding for the runtime value specifiers `@c4s/plugin-runtime` and
 * `@c4s/plugin-runtime/ui` (brief 0.1.85→0.1.86, "For implementers" #2).
 *
 * A plugin's source imports those BARE specifiers (resolved at runtime by the
 * M33 import-map shim). This file makes TypeScript resolve their TYPES to the
 * host's published surface, so a plugin can drop its vendored `c4s-runtime.d.ts`
 * and instead reference the host package once:
 *
 *   /// <reference types="@inharness-ai/claude4spec/plugin-runtime/ambient" />
 *
 * or via tsconfig `compilerOptions.types`. That single reference types BOTH the
 * value specifier and all the type names (AC1).
 *
 * This is a SCRIPT file (no top-level import/export) so the `declare module`
 * blocks are AMBIENT declarations, not augmentations. The bodies live in the
 * tsc-emitted module surfaces — re-exported here by their official subpaths, so
 * there is a single source and no hand-mirrored copy to drift. It is shipped
 * verbatim (copied into `dist/plugin-types/`), never compiled by the host, so
 * the self-package specifiers resolve on the consumer side (where the package is
 * installed), not during the host's own build.
 */

declare module '@c4s/plugin-runtime' {
  export * from '@inharness-ai/claude4spec/plugin-runtime';
}

declare module '@c4s/plugin-runtime/ui' {
  export * from '@inharness-ai/claude4spec/plugin-runtime/ui';
}
