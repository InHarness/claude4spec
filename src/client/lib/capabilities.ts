/**
 * 2.1.77 (M21 `dcagtfpe`, M23 `iifnvhtu`, M44 `1j39ajh8`) — whether the project
 * has the capability `briefs`. `capabilities` absent (config not read yet, or
 * an older server) = present. The one place that fallback is defined: the
 * `useHasBriefs` hook (hooks/useConfig.ts) and the pure `contextLinkKinds`
 * both go through it.
 */
export function hasBriefsCapability(capabilities: readonly string[] | null | undefined): boolean {
  return !capabilities || capabilities.includes('briefs');
}

/**
 * 2.1.77 (M13 `pmm7cm4c`, M20 `gv6us4lf`, M50 `0p15a2js`) — whether the
 * project has the capability `entities`. Same fallback as
 * `hasBriefsCapability`: `capabilities` absent = present.
 */
export function hasEntitiesCapability(capabilities: readonly string[] | null | undefined): boolean {
  return !capabilities || capabilities.includes('entities');
}
