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
