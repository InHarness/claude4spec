/**
 * The package's Express error handler.
 *
 * The handler is the subset of the host's `routes/errors.ts` that these two
 * types can actually raise. A router mounted by a plugin terminates its own
 * error chain — reaching for the host's handler would be reaching for a host
 * internal, and the host's table maps three dozen codes belonging to release,
 * brief, patch and remote flows that nothing here can produce.
 *
 * `DomainError` is the one thing here that is NOT the package's own. It was
 * copied from the host at first, which type-checked and was wrong: the host
 * narrows on it with `instanceof`, in the MCP entity-tools error mapper and in
 * its global Express handler, and class identity is nominal. A second class of
 * the same shape turned every `SLUG_CONFLICT` raised by these services into an
 * `INTERNAL` 500 by the time it reached an agent or a version-restore caller.
 * 0.2.2 publishes the host's class through the runtime facade for exactly this
 * reason; re-exported here so the services' import path stays local.
 */

import type { ErrorRequestHandler } from 'express';
import { DomainError } from '@c4s/plugin-runtime';

export { DomainError };

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
