import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import { errorHandler } from './errors.js';
import { DomainError } from '../services/tags.js';

// 0.1.104 regression: a streaming response (e.g. the external-skills ZIP
// download) can error after headers/bytes are already on the wire. Calling
// res.status()/res.json() at that point throws ERR_HTTP_HEADERS_SENT —
// errorHandler must delegate to Express's built-in final handler via next(err)
// instead, exactly as documented for Express error-handling middleware.
describe('errorHandler', () => {
  it('delegates to next(err) instead of writing a response when headers are already sent', () => {
    const next = vi.fn();
    const status = vi.fn();
    const res = { headersSent: true, status } as unknown as Response;

    errorHandler(new DomainError('VALIDATION', 'bad input'), {} as Request, res, next);

    expect(status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('still writes a normal response when headers have not been sent', () => {
    const next = vi.fn();
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const res = { headersSent: false, status } as unknown as Response;

    errorHandler(new DomainError('VALIDATION', 'bad input'), {} as Request, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({ error: { code: 'VALIDATION', message: 'bad input' } });
  });
});
