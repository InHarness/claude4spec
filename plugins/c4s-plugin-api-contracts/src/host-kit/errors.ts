/**
 * The package's own error vocabulary and Express error handler.
 *
 * `DomainError` is copied from the host's `services/tags.ts` and the handler is
 * the subset of the host's `routes/errors.ts` that these two types can actually
 * raise. A router mounted by a plugin terminates its own error chain — reaching
 * for the host's handler would be reaching for a host internal, and the host's
 * table maps three dozen codes belonging to release, brief, patch and remote
 * flows that nothing here can produce.
 */

import type { ErrorRequestHandler } from 'express';

export class DomainError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

const STATUS_FOR_CODE: Record<string, number> = {
  NOT_FOUND: 404,
  VERSION_NOT_FOUND: 404,
  SLUG_CONFLICT: 409,
  VALIDATION: 400,
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  // A response can error after bytes are already on the wire; setting a status
  // then throws ERR_HTTP_HEADERS_SENT. Delegating to Express's final handler is
  // the documented pattern — it detects headersSent and destroys the socket.
  if (res.headersSent) return next(err);
  if (err instanceof DomainError) {
    return res.status(STATUS_FOR_CODE[err.code] ?? 400).json({
      error: { code: err.code, message: err.message },
    });
  }
  console.error(err);
  res.status(500).json({ error: { code: 'INTERNAL', message: (err as Error).message } });
};
