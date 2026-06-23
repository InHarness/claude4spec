/**
 * Minimal ambient types for `semver` (v6, shipped without bundled types and
 * without `@types/semver` installed). Only the surface the plugin loader uses.
 * If `@types/semver` is ever added as a devDependency, delete this shim.
 */
declare module 'semver' {
  type SatisfiesOptions = boolean | { includePrerelease?: boolean; loose?: boolean };

  /** True if `version` satisfies `range`. Returns false (never throws) on invalid input. */
  export function satisfies(version: string, range: string, optionsOrLoose?: SatisfiesOptions): boolean;

  const semver: { satisfies: typeof satisfies };
  export default semver;
}
