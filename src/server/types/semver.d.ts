/**
 * Minimal ambient types for `semver` (v6, shipped without bundled types and
 * without `@types/semver` installed). Only the surface the plugin loader uses.
 * If `@types/semver` is ever added as a devDependency, delete this shim.
 */
declare module 'semver' {
  type SatisfiesOptions = boolean | { includePrerelease?: boolean; loose?: boolean };

  /** True if `version` satisfies `range`. Returns false (never throws) on invalid input. */
  export function satisfies(version: string, range: string, optionsOrLoose?: SatisfiesOptions): boolean;

  /** The lowest version `range` admits, or `null`; throws on an invalid range. */
  export function minVersion(range: string): { version: string } | null;
  /** -1 / 0 / 1 ordering of two valid versions. */
  export function compare(a: string, b: string): -1 | 0 | 1;
  /** `a <= b` for two valid versions. */
  export function lte(a: string, b: string): boolean;

  const semver: {
    satisfies: typeof satisfies;
    minVersion: typeof minVersion;
    compare: typeof compare;
    lte: typeof lte;
  };
  export default semver;
}
