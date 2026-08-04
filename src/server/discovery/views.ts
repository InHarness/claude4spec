/**
 * The view vocabulary, and the ONE guard over it.
 *
 * 0.2.9: `describe_types` used to take `input.view` on trust and let the value
 * reach the serializer, so the only thing standing between a typo and a silent
 * empty schema was a zod enum in the MCP transport and a second list in the CLI
 * — two transport-local copies of a rule, and no rule at all for any caller
 * that arrived another way. The guard belongs to the core, where every transport
 * inherits it, which is the same reasoning that moved the FS-scope builder in
 * this release.
 */

import { VIEW_KINDS, type ViewKind } from '../serialization/types.js';
import { invalidView } from './errors.js';

export { VIEW_KINDS };

/** `undefined` ⇒ the caller's default; anything outside the vocabulary ⇒ INVALID_VIEW. */
export function requireView(view: string | undefined, fallback: ViewKind): ViewKind {
  if (view === undefined) return fallback;
  if (!VIEW_KINDS.includes(view as ViewKind)) throw invalidView(view, [...VIEW_KINDS]);
  return view as ViewKind;
}

/** Same vocabulary check where "no view" means "all of them", not a default. */
export function optionalView(view: string | undefined): ViewKind | undefined {
  if (view === undefined) return undefined;
  return requireView(view, 'detail');
}
