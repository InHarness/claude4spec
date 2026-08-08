import type { ErrorRequestHandler } from 'express';
import { DomainError } from '../services/tags.js';
import { ConflictError } from '../services/brief.js';
import { BriefFsError } from '../../core/briefs/types.js';
import { isDiscoveryError } from '../discovery/errors.js';
import { STATUS_FOR_CODE, STATUS_FOR_DISCOVERY_CODE, httpStatusForCode } from '../operations/error-codes.js';

/**
 * The status for a `DomainError`'s code: this channel's own table first, the
 * shared resolver second.
 *
 * Not simply `httpStatusForCode`, and the difference is the class dispatch this
 * file documents above. That function prefers the DISCOVERY table, which is
 * right for a code arriving from the core and wrong here: `SECTION_NOT_FOUND` is
 * 404 when the core cannot address a section and 400 when a domain write is
 * malformed about one, and handing this branch to the shared resolver would
 * collapse the two into 404.
 *
 * The bug it does fix: `STATUS_FOR_CODE[code] ?? 400` alone flattened every code
 * that lives ONLY in the discovery table — `ENTITY_NOT_FOUND`, `PAGE_NOT_FOUND`,
 * `INVALID_TYPE`, `AMBIGUOUS_ENTITY`, `INDEX_NOT_MATERIALIZED` — to 400, while
 * the same code raised through `entities-router`'s tool proxy answered 404/409/503.
 * Two renderings of one code is what the shared table exists to prevent. And a
 * `DomainError('INTERNAL')` — what `decodeToolFailure` yields for a crashed plugin
 * handler — reported a server fault as a malformed request.
 */
function statusForDomainCode(code: string): number {
  return STATUS_FOR_CODE[code] ?? httpStatusForCode(code);
}

/**
 * The `rest` rendering of the operation catalog's error taxonomy.
 *
 * 0.2.13 — the two status tables moved to `operations/error-codes.ts`. They used
 * to live here, which read as "REST owns these codes"; it never did. A code is
 * declared once by the catalog and MAPPED by each channel — REST onto a status,
 * CLI onto an exit code, MCP into the tool envelope. Nothing about the HTTP
 * behaviour changed with the move; this file is still the only place that turns
 * a thrown error into a response.
 *
 * Dispatch is by error CLASS, not by code, and deliberately so: `SECTION_NOT_FOUND`
 * is 404 when the discovery core fails to ADDRESS a section and 400 when a domain
 * write is malformed about one. The class is what tells those apart.
 *
 * The hint is FORWARDED rather than folded into the message. It is the half of
 * the error that says which call would have worked, and a client that wants to
 * render it differently from the message has to be able to tell them apart.
 */

export const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  // A streaming response (e.g. the external-skills ZIP download) can error
  // after headers/bytes are already on the wire — setting a status/body at
  // that point throws ERR_HTTP_HEADERS_SENT. Delegating to Express's built-in
  // final handler is the documented pattern: it detects headersSent and just
  // destroys the socket instead of trying to write a response.
  if (res.headersSent) {
    return next(err);
  }
  if (err instanceof ConflictError) {
    return res.status(409).json({
      error: { code: err.code, message: err.message },
      currentHash: err.currentHash,
      ...(err.currentContent !== undefined ? { currentContent: err.currentContent } : {}),
    });
  }
  if (isDiscoveryError(err)) {
    return res
      .status(STATUS_FOR_DISCOVERY_CODE[err.code] ?? 400)
      .json({ error: { code: err.code, message: err.message, hint: err.hint } });
  }
  /**
   * 0.2.13 — `POST /api/patches` runs the same core writer the CLI used to run
   * in its own process (`core/briefs/file-patch.ts`), so its refusals now have
   * to reach an HTTP client. Mapped here rather than translated at the route:
   * the route would have had to invent a second vocabulary for the same three
   * outcomes, which is exactly the drift this release exists to remove.
   * `INVALID_ARGS` is the core's name for what REST calls `VALIDATION`.
   */
  if (err instanceof BriefFsError) {
    const code = err.code === 'INVALID_ARGS' ? 'VALIDATION' : err.code;
    return res
      .status(statusForDomainCode(code))
      .json({ error: { code, message: err.message, ...(err.hint ? { hint: err.hint } : {}) } });
  }
  if (err instanceof DomainError) {
    const status = statusForDomainCode(err.code);
    return res
      .status(status)
      .json({ error: { code: err.code, message: err.message, ...(err.hint ? { hint: err.hint } : {}) } });
  }
  console.error(err);
  res.status(500).json({ error: { code: 'INTERNAL', message: (err as Error).message } });
};
