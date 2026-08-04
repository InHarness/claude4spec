import type { ErrorRequestHandler } from 'express';
import { DomainError } from '../services/tags.js';
import { ConflictError } from '../services/brief.js';
import { isDiscoveryError, type DiscoveryErrorCode } from '../discovery/errors.js';

/**
 * 0.2.9 — the discovery core's catalogue, mapped onto HTTP.
 *
 * Needed the moment a route reads through `DiscoveryCore` (the keyed-collection
 * window and overview are the first to do so). Without it a `DiscoveryError`
 * falls to the bottom of this handler and is reported as `500 INTERNAL` — so
 * "no such spreadsheet" and "the server broke" arrive as the same answer, and
 * the `hint` the core went out of its way to attach is dropped on the floor.
 *
 * The hint is FORWARDED rather than folded into the message. It is the half of
 * the error that says which call would have worked, and a client that wants to
 * render it differently from the message has to be able to tell them apart.
 */
const STATUS_FOR_DISCOVERY_CODE: Record<DiscoveryErrorCode, number> = {
  ENTITY_NOT_FOUND: 404,
  SECTION_NOT_FOUND: 404,
  PAGE_NOT_FOUND: 404,
  INVALID_TYPE: 404,
  INVALID_VIEW: 400,
  INVALID_ARGUMENT: 400,
  AMBIGUOUS_ENTITY: 409,
  AMBIGUOUS_PAGE: 409,
  INDEX_NOT_MATERIALIZED: 503,
};

const STATUS_FOR_CODE: Record<string, number> = {
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
  // M23 Patches
  PATCH_CONFLICT: 409,
  PATCH_INVALID_FRONTMATTER: 400,
  // M36 chat artifacts (brief/patch/plan, shared)
  IMMUTABLE_FIELD: 400,
  UNKNOWN_ARTIFACT_KIND: 404,
  // 0.1.127 M10 Plans (filesystem-backed)
  PLAN_CONFLICT: 409,
  PLAN_INVALID_FRONTMATTER: 400,
  MISSING_TITLE: 400,
  THREAD_NOT_ATTACHED_TO_PLAN: 400,
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
  if (err instanceof DomainError) {
    const status = STATUS_FOR_CODE[err.code] ?? 400;
    return res.status(status).json({ error: { code: err.code, message: err.message } });
  }
  console.error(err);
  res.status(500).json({ error: { code: 'INTERNAL', message: (err as Error).message } });
};
