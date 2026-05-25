import type { ErrorRequestHandler } from 'express';
import { DomainError } from '../services/tags.js';
import { ConflictError } from '../services/brief.js';

const STATUS_FOR_CODE: Record<string, number> = {
  NOT_FOUND: 404,
  VERSION_NOT_FOUND: 404,
  SLUG_CONFLICT: 409,
  VALIDATION: 400,
  SECTION_NOT_FOUND: 400,
  AMBIGUOUS_HEADING: 400,
  MISSING_TARGET: 400,
  // M17
  RELEASE_NAME_CONFLICT: 409,
  RELEASE_DESCRIPTION_REQUIRED: 400,
  RELEASE_FROZEN: 409,
  NOT_IMPLEMENTED: 501,
  // M21 Briefs
  BRIEF_SAME_RELEASE: 400,
  BRIEF_FRONTMATTER_IMMUTABLE: 400,
  BRIEF_INVALID_FRONTMATTER: 400,
  BRIEF_CONFLICT: 409,
  PAGE_CONFLICT: 409,
  // M23 Patches
  PATCH_CONFLICT: 409,
  PATCH_FRONTMATTER_IMMUTABLE: 400,
  PATCH_INVALID_FRONTMATTER: 400,
  // M24 Remote Account
  NO_ACTIVE_FLOW: 400,
  REMOTE_UNAUTHORIZED: 401,
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ConflictError) {
    return res.status(409).json({
      error: { code: err.code, message: err.message },
      currentHash: err.currentHash,
    });
  }
  if (err instanceof DomainError) {
    const status = STATUS_FOR_CODE[err.code] ?? 400;
    return res.status(status).json({ error: { code: err.code, message: err.message } });
  }
  console.error(err);
  res.status(500).json({ error: { code: 'INTERNAL', message: (err as Error).message } });
};
