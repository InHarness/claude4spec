import { describe, expect, it } from 'vitest';
import { ApiError, handle } from './api-core.js';

/**
 * 0.2.88 — a 409 `PAGE_CONFLICT` carries `currentHash` / `currentContent`
 * BESIDE the `error` envelope (`routes/errors.ts`). The page editor's conflict
 * dialog offers "Reload" from exactly those two fields, so `handle()` has to
 * keep the whole body on the thrown error, not only `error`.
 */
describe('handle() keeps the whole 409 body on ApiError', () => {
  it('exposes top-level currentHash / currentContent through `body`', async () => {
    const res = new Response(
      JSON.stringify({
        error: { code: 'PAGE_CONFLICT', message: 'page changed since last read' },
        currentHash: 'abc123',
        currentContent: '# Server copy\n',
      }),
      { status: 409, headers: { 'Content-Type': 'application/json' } },
    );
    const err = await handle(res).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    const api = err as ApiError;
    expect(api.code).toBe('PAGE_CONFLICT');
    expect(api.status).toBe(409);
    expect(api.details).toEqual({ code: 'PAGE_CONFLICT', message: 'page changed since last read' });
    expect(api.body?.currentHash).toBe('abc123');
    expect(api.body?.currentContent).toBe('# Server copy\n');
  });

  it('leaves `body` undefined when the failure carries no JSON', async () => {
    const res = new Response('nope', { status: 500, statusText: 'Internal Server Error' });
    const err = (await handle(res).catch((e: unknown) => e)) as ApiError;
    expect(err.code).toBe('HTTP_ERROR');
    expect(err.body).toBeUndefined();
  });
});
