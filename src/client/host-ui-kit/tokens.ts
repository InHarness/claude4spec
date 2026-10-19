/**
 * M34 / L12 — token bridge.
 *
 * The Host UI Kit exposes the host's RESOLVED presentation tokens to plugins as
 * the SAME CSS variables the host itself uses: color (`--c-*`), typography
 * (`--text-*`/`--font-*`/`--weight-*`), and layering (`--z-popover`/`--z-toast`).
 * Because the variables cascade from `:root` / `.dark` (see `styles/theme.css`),
 * a plugin's entity view styled with `var(--c-accent)` or `var(--text-lede)`
 * automatically matches the host — the components here, and any plugin markup,
 * just reference `var(--...)`.
 *
 * Source of truth for the token set is the ONE canonical design-system entity
 * `c4s-paper-terra` (paper/terra palette, Inter/Lora/JetBrains Mono, motion,
 * layering, light/dark). The active light/dark mode is the M26 preference, which
 * is applied by toggling the `.dark` class on `<html>` (`state/tweaks.ts`,
 * persisted in `localStorage` `c4s:settings:theme`). {@link useHostTokens} reads
 * the resolved values and re-reads whenever that class changes, so it always
 * reflects the active mode. Typography and z-index tokens are mode-invariant
 * (defined once in `:root`, not duplicated into `.dark`) — they don't change
 * with the light/dark toggle, only color does.
 *
 * Closed dictionary. The names below are the only host tokens: host and
 * envelope code use no `--c-*` variable outside them, not even as a
 * `var(--x, …)` fallback (`token-dictionary.test.ts` scans for it).
 *
 * DELIBERATE DEBT — entity ↔ code. The bridge names have four
 * representations: the entity `c4s-paper-terra`, the host theme stylesheet
 * (`styles/theme.css`), this constant and the published `HostTokenName` union
 * (`plugin-types/ui.ts`). The three in code hold one name set under test
 * (`token-dictionary.test.ts`). Only the entity ↔ code pair is kept by hand:
 * no linter compares the entity with the code, so that criterion is verified
 * manually.
 */

/** The resolved presentation tokens the bridge exposes — the closed dictionary of host tokens (`--c-*`/`--text-*`/`--font-*`/`--weight-*`/`--z-*`). */
export const HOST_TOKEN_NAMES = [
  '--c-bg',
  '--c-panel',
  '--c-card',
  '--c-ink',
  '--c-muted',
  '--c-subtle',
  '--c-hair',
  '--c-hair-strong',
  '--c-accent',
  '--c-accent-soft',
  '--c-accent-ink',
  '--c-yellow',
  '--c-yellow-ink',
  '--c-green',
  '--c-green-soft',
  '--c-blue',
  '--c-blue-soft',
  '--c-purple',
  '--c-purple-soft',
  '--c-red',
  '--c-red-soft',
  '--font-heading',
  '--font-body',
  '--font-mono',
  '--text-h1',
  '--text-h2',
  '--text-h3',
  '--text-body',
  '--text-lede',
  '--text-code',
  '--text-sm',
  '--text-xs',
  '--text-2xs',
  '--weight-heading',
  '--weight-body',
  '--weight-lede',
  '--z-popover',
  '--z-toast',
] as const;

export type HostTokenName = (typeof HOST_TOKEN_NAMES)[number];

/** Read the resolved `--c-*` values off `<html>` for the active theme. */
export function readHostTokens(): Record<HostTokenName, string> {
  const out = {} as Record<HostTokenName, string>;
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    // SSR / non-DOM: return empty strings rather than throwing.
    for (const name of HOST_TOKEN_NAMES) out[name] = '';
    return out;
  }
  const cs = getComputedStyle(document.documentElement);
  for (const name of HOST_TOKEN_NAMES) out[name] = cs.getPropertyValue(name).trim();
  return out;
}
