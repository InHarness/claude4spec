import { optionalString, type ParsedArgs } from './args.js';

/**
 * Shared `--model` parsing for `c4s agent`/`c4s ask`.
 *
 * 0.2.108: pass-through, no local list. The selectable models are the PEER's
 * contract — each project publishes its own through `GET /api/chat/config` — and
 * the peer refuses anything outside it with `400` before the turn is dispatched.
 * The local check used to exist because the server silently fell back to its own
 * default; that fallback is gone, and a copy of the list here would only be a
 * second, staler answer to a question the peer already answers. Absent flag →
 * `undefined`, so `runAgent` applies `DEFAULT_MODEL`.
 */
export function parseModelFlag(args: ParsedArgs): string | undefined {
  return optionalString(args, 'model');
}
