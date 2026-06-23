import { describe, expect, it, afterEach, vi } from 'vitest';
import { runAsk, AskError } from './run-ask.js';

/**
 * Reaches `healthCheck` by passing `server` + an unregistered `project` path:
 * `resolveWorkspaceProject` throws, run-ask derives the projectId from the path,
 * then hits `GET <server>/api/projects/<id>/config` — which we stub.
 */
function stubConfigResponse(res: { status: number; ok: boolean; json: () => unknown }): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      status: res.status,
      ok: res.ok,
      json: async () => res.json(),
    })),
  );
}

const ASK = { message: 'hi', server: 'http://localhost:9999', project: '/tmp/c4s-unregistered-xyz' };

describe('runAsk healthCheck — build-failure surfacing', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('surfaces PROJECT_BUILD_FAILED with the real message instead of masking it', async () => {
    const message = 'config.json: writingStyle "X" was found on disk but skipped: version 2 > supported 1';
    stubConfigResponse({
      status: 500,
      ok: false,
      json: () => ({ error: { code: 'PROJECT_BUILD_FAILED', message } }),
    });

    const err = await runAsk(ASK).catch((e) => e);
    expect(err).toBeInstanceOf(AskError);
    expect((err as AskError).code).toBe('PROJECT_BUILD_FAILED');
    expect((err as AskError).message).toBe(message);
  });

  it('still reports SERVER_NOT_RECOGNIZED for a non-c4s error response (no envelope)', async () => {
    stubConfigResponse({ status: 500, ok: false, json: () => ({}) });

    const err = await runAsk(ASK).catch((e) => e);
    expect(err).toBeInstanceOf(AskError);
    expect((err as AskError).code).toBe('SERVER_NOT_RECOGNIZED');
  });
});
