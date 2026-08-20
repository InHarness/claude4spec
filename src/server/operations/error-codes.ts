/**
 * L3 — the shared error taxonomy of the operation catalog.
 *
 * The rule the four channels are held to: **a channel MAPS the taxonomy, it
 * never invents codes of its own.** `internal` and `mcp` carry the code inside
 * the MCP error envelope, `rest` maps it onto a status, `cli` maps it onto an
 * exit code — but they are all naming the same refusal, so a caller that learns
 * one channel's vocabulary has learned all four.
 *
 * These two tables used to live in `routes/errors.ts`, which made REST look like
 * their owner. They moved here in 0.2.13 so the layering matches the contract:
 * the catalog owns the codes, `routes/errors.ts` is one renderer of them (it
 * still imports and applies them — nothing about the HTTP behaviour changed).
 *
 * Error CONTENT is contractual too, not just the code. `NOT_FOUND` carries the
 * alternatives; `INVALID_ARGUMENT` carries the repair path. The discovery core
 * already builds both (`invalidType(type, activeTypes)`, `entityNotFound`), and
 * a transport must forward that `hint` rather than re-phrasing it — two surfaces
 * paraphrasing the same refusal is how they start disagreeing about it.
 */

import type { DiscoveryErrorCode } from '../discovery/errors.js';

/** The discovery core's catalogue, mapped onto HTTP. */
export const STATUS_FOR_DISCOVERY_CODE: Record<DiscoveryErrorCode, number> = {
  ENTITY_NOT_FOUND: 404,
  SECTION_NOT_FOUND: 404,
  PAGE_NOT_FOUND: 404,
  INVALID_TYPE: 404,
  INVALID_ARGUMENT: 400,
  AMBIGUOUS_ENTITY: 409,
  AMBIGUOUS_PAGE: 409,
  INDEX_NOT_MATERIALIZED: 503,
};

/** Domain codes, mapped onto HTTP. Anything absent is a client error (400). */
export const STATUS_FOR_CODE: Record<string, number> = {
  NOT_FOUND: 404,
  VERSION_NOT_FOUND: 404,
  SLUG_CONFLICT: 409,
  VALIDATION: 400,
  SECTION_NOT_FOUND: 400,
  AMBIGUOUS_HEADING: 400,
  AMBIGUOUS_ANCHOR: 400,
  MISSING_TARGET: 400,
  // M17
  RELEASE_NAME_CONFLICT: 409,
  RELEASE_SLUG_CONFLICT: 409,
  RELEASE_DESCRIPTION_REQUIRED: 400,
  RELEASE_FROZEN: 409,
  RELEASE_NAME_RESERVED: 400,
  NOT_IMPLEMENTED: 501,
  // M21 Briefs
  BRIEF_SAME_RELEASE: 400,
  BRIEF_INVALID_FRONTMATTER: 400,
  BRIEF_CONFLICT: 409,
  PAGE_CONFLICT: 409,
  /**
   * 0.2.13 (M02) — the page WRITE operations' own two codes.
   *
   * Both were already produced by `routes/pages.ts`, hand-rolled into a literal
   * `res.status(409)`, which is why neither was in this table: the route never
   * consulted it. They are here now because the codes belong to the operation
   * rather than to its REST rendering — `create_page` answers `PAGE_EXISTS` on
   * every channel, and each channel maps it from this one declaration.
   */
  PAGE_EXISTS: 409,
  ROOT_NOT_FOUND: 404,
  /**
   * 0.2.17 (M06) — `update_sections` would destroy an anchor something cites.
   *
   * 400 and not 409, sitting one line from `PAGE_CONFLICT` which IS 409, because
   * the two say opposite things about a retry. `PAGE_CONFLICT` means "your hash
   * is stale" — re-read, re-apply, and the identical intent succeeds. This
   * refusal is deterministic: nothing about the server will change the answer,
   * so replaying the same request refuses again forever. The repair is in the
   * REQUEST (declare the anchors in `dropAnchors`, or send content that
   * reproduces them), which is what the 4xx/`INVALID_ARGUMENT` class means.
   */
  ANCHOR_LOSS: 400,
  /**
   * 0.2.37 (M02/M06) — the differential write's own two refusals.
   *
   * Both are 400 for the reason stated one comment above: they are
   * DETERMINISTIC. A `find` that matched nothing matches nothing on the retry
   * too, and a count that came out wrong comes out wrong again — no amount of
   * re-reading the page changes either answer. The repair is in the REQUEST
   * (fix the pattern, or fix the declaration), which is what the 400 class
   * means here. Sending them as 409 would tell a client to do the one thing
   * that cannot help.
   */
  FIND_NOT_FOUND: 400,
  MATCH_COUNT_MISMATCH: 400,
  /**
   * 0.2.13 — reached HTTP with `POST /api/patches`. It existed before only as a
   * CLI/core code (`core/briefs/types.ts`), because filing a patch was an
   * fs-scoped CLI operation with no server route; the route made the same
   * refusal answerable over REST.
   */
  BRIEF_NOT_FOUND: 404,
  // M23 Patches
  PATCH_CONFLICT: 409,
  PATCH_INVALID_FRONTMATTER: 400,
  /** Same story as BRIEF_NOT_FOUND — the write now happens server-side. */
  PATCH_WRITE_FAILED: 500,
  // M36 chat artifacts (brief/patch/plan, shared)
  IMMUTABLE_FIELD: 400,
  UNKNOWN_ARTIFACT_KIND: 404,
  // 0.1.127 M10 Plans (filesystem-backed)
  PLAN_CONFLICT: 409,
  PLAN_INVALID_FRONTMATTER: 400,
  MISSING_TITLE: 400,
  THREAD_NOT_ATTACHED_TO_PLAN: 400,
  /**
   * 0.2.13 — `POST /api/chat/abort/:threadId` has to tell "no such thread" apart
   * from "that thread has no turn running". The second is an idempotent no-op;
   * conflating them made an abort against a typo'd id look like a success.
   */
  THREAD_NOT_FOUND: 404,
  /**
   * 0.2.15 — a second turn on a thread that is already streaming is REJECTED,
   * not queued, and 409 is the status that says so.
   *
   * This is the turn family's concurrency guard, and it is STATEFUL where the
   * page and plan families are hash-based: there is no `expectedHash` for "a
   * turn is in flight". It was raised in two routes as a hand-rolled literal,
   * which meant the one code the CLI and the agent client both branch on was
   * absent from the single table that is supposed to define it.
   */
  STREAM_IN_PROGRESS: 409,
  // M24 Remote Account
  NO_ACTIVE_FLOW: 400,
  REMOTE_UNAUTHORIZED: 401,
  // M25 Release Push
  NOT_CONNECTED: 409,
  ACCOUNT_NOT_ACTIVE: 409,
  RELEASE_NOT_FOUND: 404,
  RELEASE_PUSH_NOT_FOUND: 404,
  SESSION_EXPIRED: 502,
  PUSH_FAILED: 502,
};

/**
 * The `rest` channel's rendering of a catalog code. Discovery codes win when a
 * code appears in both tables (`SECTION_NOT_FOUND` does — 404 from the core's
 * addressing failure, 400 from a malformed domain write).
 */
/**
 * Codes that mean "the server failed", whatever produced them.
 *
 * The 400 default below is right for a code the tables do not carry: an
 * unrecognised refusal from a handler that CHOSE to refuse is a refusal of the
 * request. `INTERNAL` is the one code where that reasoning inverts — it is what
 * `decodeToolFailure` yields when a plugin's handler crashed or answered with
 * something unparseable, and reporting a crash as 400 tells the caller their
 * request was malformed. A client branching on 4xx-versus-5xx then does the
 * opposite of the right thing twice over: it does not retry, and it does not
 * escalate.
 *
 * This is also the status a thrown non-`DomainError` already gets from
 * `routes/errors.ts`, so the two paths out of the same failure now agree —
 * which is what the tool-proxy route's own comment claims ("exactly as it would
 * had the handler thrown").
 */
const SERVER_FAULT_CODES: ReadonlySet<string> = new Set(['INTERNAL']);

export function httpStatusForCode(code: string): number {
  const discovery = STATUS_FOR_DISCOVERY_CODE[code as DiscoveryErrorCode];
  if (discovery !== undefined) return discovery;
  const known = STATUS_FOR_CODE[code];
  if (known !== undefined) return known;
  return SERVER_FAULT_CODES.has(code) ? 500 : 400;
}
