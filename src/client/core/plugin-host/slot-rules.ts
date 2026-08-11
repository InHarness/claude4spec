/**
 * 0.2.16 — what a frontend manifest must and must not declare, in ONE place.
 *
 * There are two doors into registration: `clientPluginHost.registerFrontendModule`
 * (throws — a built-in or a directly-imported module is a programming error if
 * it is malformed) and `validateFrontendModule` in the runtime plugin loader
 * (skips with a warning — a third-party bundle must not take the host down).
 * They used to carry two hand-maintained copies of the same slot lists, with a
 * comment on each begging the next author to keep them in step. A module that
 * passed one and failed the other was the drift that comment was guarding
 * against; this file removes the possibility instead.
 *
 * The rules enforce CONSISTENCY, not COMPLETENESS. A type is free to skip its
 * list row, its detail page and its sidebar entry — what it may not do is
 * declare half of a pair.
 */

import type { FrontendModule } from './types.js';

/** Every module renders as a chip and as a card — that is what "embeddable" means. */
const REQUIRED_COMPONENT_SLOTS = ['renderChip', 'renderCard'] as const;
const REQUIRED_FUNCTION_SLOTS = ['useGetBySlug', 'listByTags'] as const;

/**
 * A HIDDEN entity: no detail route and no detail panel, therefore no place of
 * its own in the app. It is reachable only through XML references on a page (a
 * chip for an inline mention, a card for a single embed) and through the agent
 * / MCP.
 *
 * Derived, never declared. 0.2.15 shipped an `embedOnly: true` flag beside the
 * slots it described; two sources for one fact can disagree, and the flag was
 * the one that could lie. The slots are the fact.
 */
export function isHiddenModule(m: Pick<FrontendModule, 'routes' | 'detailPanel'>): boolean {
  return m.routes === undefined && m.detailPanel === undefined;
}

/**
 * The manifest's frontend half, checked. Returns the reason it is invalid, or
 * `null` when it holds up.
 */
export function checkSlotShapes(m: FrontendModule): string | null {
  for (const slot of REQUIRED_COMPONENT_SLOTS) {
    if (typeof m[slot] !== 'function') return `'${slot}' must be a React component`;
  }
  for (const slot of REQUIRED_FUNCTION_SLOTS) {
    if (typeof m[slot] !== 'function') return `'${slot}' must be a function`;
  }

  // The pair rule. Half of it is not a smaller version of it — it is a detail
  // panel nothing can render, or a detail route with nothing to put on it.
  if (m.routes !== undefined && m.detailPanel === undefined) {
    return "declares 'routes' without 'detailPanel' — a detail route needs a panel to render; declare both, or neither (a hidden entity)";
  }
  if (m.detailPanel !== undefined && m.routes === undefined) {
    return "declares 'detailPanel' without 'routes' — a detail panel needs a route to live on; declare both, or neither (a hidden entity)";
  }

  /**
   * The click-ownership exception, enforced from both sides. A hidden chip has
   * no detail route to open, so the entity owes an overlay; a chip that DOES
   * have a detail route must go through `bridge.openEntity` and nowhere else,
   * so an overlay beside it is the contract violation the brief asks the host
   * to catch — a second answer to where a click goes.
   */
  const hidden = isHiddenModule(m);
  if (hidden && typeof m.renderOverlay !== 'function') {
    return "is a hidden entity (no 'routes', no 'detailPanel') and must supply 'renderOverlay' — its chip has no detail route to open";
  }
  if (!hidden && m.renderOverlay !== undefined) {
    return "declares 'renderOverlay' while having a detail route — a chip with a detail route opens it via bridge.openEntity; the overlay exception belongs to hidden entities only";
  }

  for (const ext of m.editorExtensions ?? []) {
    if (!ext || typeof ext.name !== 'string' || ext.name.length === 0) {
      return 'an editorExtension is missing a string "name"';
    }
  }

  return null;
}
