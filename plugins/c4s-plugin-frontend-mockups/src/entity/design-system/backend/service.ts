/**
 * `design-system`'s `backend.service` — the type's DOMAIN HELPER, and the first
 * one this envelope registers.
 *
 * It is a thin facade over `design-system-domain.ts`, deliberately: `resolve()`
 * has three consumers, and two of them (`frontend.renderCard`, the L5 live
 * preview) run in the BROWSER, where no service exists. So the pure functions
 * stay the single implementation and this class only makes them reachable from
 * the server side, through `ctx.host.getEntityService('design-system')`. Adding
 * logic here — rather than in the domain module — would fork it by client.
 *
 * The consumer that needs the service form is `ui-view`'s mockup router, the
 * first place in this package where one type reaches into another type's
 * service. That is legal ONLY because both types travel in one envelope: the
 * layer rule is "out of process — HTTP, in process — a function call, and the
 * logic lives exactly once", so the router calls this in-process and never over
 * internal HTTP. Split the pair into two packages and this call becomes illegal.
 */

import { resolve } from '../../../design-system-domain.js';
import type { DesignMode, ResolvedTokenValue, TokenGroup } from '../../../types.js';
import { generateStylesheet, type ResolvedMode } from './stylesheet.js';

export class DesignSystemService {
  /**
   * Resolve every token to its concrete value for ONE mode (no `activeMode` =
   * Base). Delegates verbatim — see `design-system-domain.ts` for the alias
   * expansion and cycle rules.
   */
  resolve(
    groups: TokenGroup[],
    modes: DesignMode[],
    activeMode?: string,
  ): Record<string, ResolvedTokenValue> {
    return resolve(groups, modes, activeMode);
  }

  /**
   * The token sheet: minimal reset, `:root` base tokens, one
   * `[data-preview-mode="<name>"]` block per mode.
   *
   * Takes RESOLVED input on both axes — values already expanded, no aliases —
   * because a sheet spans every mode while `resolve()` answers for one at a
   * time. The caller does one `resolve()` per mode; see `generateStylesheet`.
   */
  toStylesheet(base: Record<string, ResolvedTokenValue>, modes: ResolvedMode[] = []): string {
    return generateStylesheet(base, modes);
  }

  /**
   * The whole job in one call: raw `groups`/`modes` (as they come off the
   * projection) → the sheet, with the per-mode `resolve()` fan-out done here.
   *
   * This exists so the fan-out lives ONCE, next to the generator that depends
   * on its shape, rather than being re-derived by every caller that wants a
   * sheet — today the mockup router, tomorrow whoever else.
   */
  stylesheetFor(groups: TokenGroup[], modes: DesignMode[]): string {
    const base = this.resolve(groups, modes);
    const resolvedModes: ResolvedMode[] = (modes ?? [])
      .filter((m) => m && typeof m.name === 'string' && m.name)
      .map((m) => ({ name: m.name, tokens: this.resolve(groups, modes, m.name) }));
    return this.toStylesheet(base, resolvedModes);
  }
}
