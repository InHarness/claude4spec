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

  it('0.2.106 (M49): a middleware client error (malformed JSON body) leaves as 400 VALIDATION, not 500', () => {
    const next = vi.fn();
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const res = { headersSent: false, status } as unknown as Response;
    // The shape `express.json` passes to `next(err)` on a body it cannot parse.
    const err = Object.assign(new SyntaxError('Unexpected token } in JSON'), { status: 400, type: 'entity.parse.failed' });

    errorHandler(err, {} as Request, res, next);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({ error: { code: 'VALIDATION', message: 'Unexpected token } in JSON' } });
  });

  it('0.2.106 (M49): an oversized body (413) folds into the closed status set as 400', () => {
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const res = { headersSent: false, status } as unknown as Response;

    errorHandler(Object.assign(new Error('request entity too large'), { status: 413 }), {} as Request, res, vi.fn());

    expect(status).toHaveBeenCalledWith(400);
  });
});
