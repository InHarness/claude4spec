import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseArgs } from '../args.js';
import { runAgentCmd } from './agent.js';

/**
 * 0.2.64 — the create/attach predicate is a single condition (`--brief` present
 * → attach). That makes an EMPTY `--brief` dangerous in a way it never was
 * before: it used to land on the "neither attach nor create" error, and would
 * now fall through to create-mode and mint a brief. `--brief "$UNSET_VAR"` is
 * exactly the shape the skills use to pass a path between steps.
 */
describe('c4s agent — an empty --brief is an argument error, not a create request', () => {
  const run = (argv: string[]) => runAgentCmd(parseArgs(argv));

  it('rejects --brief with an empty value before any server discovery', async () => {
    await expect(run(['agent', 'msg', '--ct', 'brief', '--brief', ''])).rejects.toThrow(
      /--brief needs a path/,
    );
  });

  it('rejects a valueless --brief (parsed as a boolean flag) — INVALID_ARGS by the argv rule (2.1.23)', async () => {
    await expect(run(['agent', 'msg', '--ct', 'brief', '--brief'])).rejects.toMatchObject({
      code: 'INVALID_ARGS',
      message: expect.stringMatching(/--brief requires a value/),
    });
  });
});

/**
 * 2.1.29 — `--plan <planPath>` always founds a NEW chat thread, so the flags
 * that pick a thread or another context are argument errors, refused before
 * any server discovery.
 */
describe('c4s agent --plan — local validation', () => {
  const run = (argv: string[]) => runAgentCmd(parseArgs(argv));
  afterEach(() => vi.unstubAllGlobals());

  it('[ac:ac-plan-razem-z-thread-konczy-sie-invali] --plan with --thread → INVALID_ARGS', async () => {
    await expect(run(['agent', 'msg', '--plan', 'p.md', '--thread', 'T1'])).rejects.toMatchObject({
      code: 'INVALID_ARGS',
      message: expect.stringMatching(/--plan does not go with --thread/),
    });
  });

  it('[ac:ac-plan-razem-z-brief-konczy-sie-invalid] --plan with --brief → INVALID_ARGS', async () => {
    await expect(run(['agent', 'msg', '--plan', 'p.md', '--ct', 'chat', '--brief', 'b.md'])).rejects.toMatchObject({
      code: 'INVALID_ARGS',
      message: expect.stringMatching(/--plan does not go with --brief/),
    });
  });

  it.each(['brief', 'ask', 'patch'])(
    '[ac:ac-plan-razem-z-ct-innym-niz-chat-konczy] --plan with --ct %s → INVALID_ARGS',
    async (ct) => {
      await expect(run(['agent', 'msg', '--plan', 'p.md', '--ct', ct])).rejects.toMatchObject({
        code: 'INVALID_ARGS',
        message: expect.stringMatching(new RegExp(`--ct ${ct} does not go with it`)),
      });
    },
  );

  it('rejects an empty --plan', async () => {
    await expect(run(['agent', 'msg', '--plan', ''])).rejects.toThrow(/--plan needs a path/);
  });

  it.each([[[]], [['--ct', 'chat']]])('--plan %o needs no --ct — gets past validation to server discovery', async (extra) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
      }),
    );
    await expect(
      run(['agent', 'msg', '--plan', 'p.md', ...extra, '--server', 'http://127.0.0.1:9', '--project', 'peer']),
    ).rejects.toMatchObject({ code: 'SERVER_NOT_RUNNING' });
  });
});

/**
 * 2.1.74 — `--patch <path>` founds a NEW patch thread on an existing patch. It
 * excludes the other thread selectors and needs `--ct patch`; `--ct patch`
 * with neither `--thread` nor `--patch` is the replaced "continuation only" rule.
 * All refused before any request.
 */
describe('c4s agent --patch — local validation', () => {
  const run = (argv: string[]) => runAgentCmd(parseArgs(argv));
  afterEach(() => vi.unstubAllGlobals());
  const noFetch = () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    return fetchSpy;
  };

  it('[ac:ac-ct-patch-bez-thread-i-bez-patch-koncz] --ct patch with neither --thread nor --patch → INVALID_ARGS, fix: pass --patch', async () => {
    const fetchSpy = noFetch();
    await expect(run(['agent', 'msg', '--ct', 'patch'])).rejects.toMatchObject({
      code: 'INVALID_ARGS',
      message: expect.stringMatching(/--ct patch needs --patch <path>/),
      hint: 'pass --patch <path>',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([[[]], [['--ct', 'chat']], [['--ct', 'brief']], [['--ct', 'ask']]])(
    '[ac:ac-patch-bez-ct-patch-konczy-sie-invalid] --patch with %o (not --ct patch) → INVALID_ARGS, fix: pass --ct patch',
    async (extra) => {
      const fetchSpy = noFetch();
      await expect(run(['agent', 'msg', '--patch', 'p.md', ...extra])).rejects.toMatchObject({
        code: 'INVALID_ARGS',
        message: expect.stringMatching(/needs --ct patch/),
        hint: 'pass --ct patch',
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  it('[ac:ac-patch-razem-z-thread-konczy-sie-inval] --patch with --thread → INVALID_ARGS', async () => {
    const fetchSpy = noFetch();
    await expect(run(['agent', 'msg', '--ct', 'patch', '--patch', 'p.md', '--thread', 'T1'])).rejects.toMatchObject({
      code: 'INVALID_ARGS',
      message: expect.stringMatching(/--patch does not go with --thread/),
      hint: 'pass only one of --patch, --thread, --brief, --plan',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('[ac:ac-patch-razem-z-brief-konczy-sie-invali] --patch with --brief → INVALID_ARGS', async () => {
    const fetchSpy = noFetch();
    await expect(run(['agent', 'msg', '--ct', 'patch', '--patch', 'p.md', '--brief', 'b.md'])).rejects.toMatchObject({
      code: 'INVALID_ARGS',
      message: expect.stringMatching(/--patch does not go with --brief/),
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('[ac:ac-patch-razem-z-plan-konczy-sie-invalid] --patch with --plan → INVALID_ARGS', async () => {
    const fetchSpy = noFetch();
    await expect(run(['agent', 'msg', '--ct', 'patch', '--patch', 'p.md', '--plan', 'auth-refactor.md'])).rejects.toMatchObject({
      code: 'INVALID_ARGS',
      message: expect.stringMatching(/--patch does not go with --plan/),
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects an empty --patch', async () => {
    await expect(run(['agent', 'msg', '--ct', 'patch', '--patch', ''])).rejects.toThrow(/--patch needs a path/);
  });

  it('--ct patch --patch <path> gets past validation to server discovery', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
      }),
    );
    await expect(
      run(['agent', 'msg', '--ct', 'patch', '--patch', 'p.md', '--server', 'http://127.0.0.1:9', '--project', 'peer']),
    ).rejects.toMatchObject({ code: 'SERVER_NOT_RUNNING' });
  });
});

describe('c4s agent --ct patch --patch — the command surface', () => {
  const run = (argv: string[]) => runAgentCmd(parseArgs(argv));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('[entity:cli-command/agent] declares --patch, NOT_FOUND, and prints the new patch thread\'s threadId', async () => {
    const { agentCommand } = await import('./agent.js');
    expect(agentCommand.flags).toContain('patch');
    expect(agentCommand.errorCodes).toContain('NOT_FOUND');

    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(String(url));
        const reply = (body: unknown) => ({ status: 200, ok: true, json: async () => body });
        if (String(url).endsWith('/config')) return reply({ name: 'peer', roots: [], entitiesDir: 'entities', writingStyle: null, onboarding: {} });
        if (String(url).endsWith('/threads')) return reply({ data: { threadId: 'T-patch' } });
        return reply({ threadId: 'T-patch', answer: 'done', messages: [] });
      }),
    );
    let out = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      out += String(chunk);
      return true;
    });
    await run(['agent', 'msg', '--ct', 'patch', '--patch', '.claude4spec/patches/v1-drift.md', '--server', 'http://localhost:9999', '--project', 'peer']);
    expect(urls.some((u) => /\/api\/projects\/peer\/artifacts\/patch\/v1-drift\.md\/threads$/.test(u))).toBe(true);
    expect(JSON.parse(out)).toMatchObject({ threadId: 'T-patch', answer: 'done' });
  });
});
