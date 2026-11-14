import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseArgs } from '../args.js';
import { runAsk_cli } from './ask.js';
import { consultationContextType } from '../../../server/services/context-types/registry.js';
import { startConsultationPeer, type ConsultationPeer } from '../../../../tests/helpers/consultation-peer.js';

/**
 * `c4s ask` names no context — the peer picks the value of a consultation — and
 * refuses every context flag of `c4s agent` (2.1.29 adds `--plan` to `--ct` /
 * `--brief`).
 */
describe('c4s ask — context flags are refused locally', () => {
  const run = (argv: string[]) => runAsk_cli(parseArgs(argv));

  it('[ac:ac-c4s-ask-z-plan-konczy-sie-invalid-arg] `c4s ask … --plan` → INVALID_ARGS before any request', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    try {
      await expect(run(['ask', 'msg', '--plan', 'auth-refactor.md'])).rejects.toMatchObject({
        code: 'INVALID_ARGS',
        message: expect.stringMatching(/does not take --plan/),
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('[ac:ac-c4s-ask-z-patch-konczy-sie-invalid-ar] `c4s ask … --patch` → INVALID_ARGS before any request', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    try {
      await expect(run(['ask', 'msg', '--patch', 'v1-to-v2-drift.md'])).rejects.toMatchObject({
        code: 'INVALID_ARGS',
        message: expect.stringMatching(/does not take --patch/),
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('[entity:cli-command/ask] declares --patch only to refuse it', async () => {
    const { askCommand } = await import('./ask.js');
    expect(askCommand.flags).toContain('patch');
  });
});

/**
 * 2.1.88 (M11 `m11dcore`) — `c4s ask` names no value: the peer founds a
 * consultation thread through `POST /api/threads` with `entry: "consultation"`,
 * picks its `Wejście: konsultacja` value and records the origin. A live peer
 * (real thread routes, real store) answers; only the agent turn is mocked.
 */
const turnMock = vi.hoisted(() =>
  vi.fn(async (_deps: unknown, input: { thread: { id: string } }) => ({
    threadId: input.thread.id,
    answer: 'The endpoint returns 201.',
    messages: [
      { role: 'assistant', content: 'Let me look at the endpoint first.' },
      { role: 'assistant', content: 'The endpoint returns 201.' },
    ],
  })),
);
vi.mock('../../../server/routes/agent-turn.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../server/routes/agent-turn.js')>();
  return { ...actual, runAgentTurn: turnMock };
});

describe('c4s ask — the consultation entry (2.1.88)', () => {
  let peer: ConsultationPeer | undefined;
  let stdout: string[];
  let writeSpy: ReturnType<typeof vi.spyOn> | undefined;

  beforeEach(() => {
    turnMock.mockClear();
    stdout = [];
    writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => {
      stdout.push(String(chunk));
      return true;
    }) as typeof process.stdout.write);
  });
  afterEach(async () => {
    writeSpy?.mockRestore();
    await peer?.close();
    peer = undefined;
  });

  const ask = (p: ConsultationPeer, ...extra: string[]) =>
    runAsk_cli(parseArgs(['ask', 'What does POST /api/things return?', '--server', p.url, '--project', p.projectId, ...extra]));

  it('[ac:ac-c4s-ask-msg-jest-aliasem-c4s-agen] runs the peer turn in the peer\'s `Wejście: konsultacja` value, on a thread the peer founded as a consultation thread', async () => {
    peer = await startConsultationPeer();
    await ask(peer);

    const rows = peer.threads();
    expect(rows).toHaveLength(1);
    // The value is the one the PEER's registry gives the consultation entry.
    expect(rows[0]!.context_type).toBe(consultationContextType());
    expect(rows[0]!.consultation).toBe(1);
    // …and the turn ran on that thread.
    expect(turnMock).toHaveBeenCalledTimes(1);
    expect(turnMock.mock.calls[0]![1].thread.id).toBe(rows[0]!.id);
  });

  it('[ac:ac-c4s-ask-msg-zwraca-wylacznie-ostatnia] prints only the last answer of the peer turn, as `{ threadId, answer }`', async () => {
    peer = await startConsultationPeer();
    await ask(peer);

    const printed = JSON.parse(stdout.join(''));
    const threadId = peer.threads()[0]!.id;
    expect(printed).toEqual({ threadId, answer: 'The endpoint returns 201.' });
    // No intermediate text, no message list.
    expect(stdout.join('')).not.toContain('Let me look at the endpoint first.');
  });

  it('[ac:ac-c4s-ask-z-flaga-kontekstu-ct-albo-bri] `c4s ask` with `--ct` or `--brief` ends with INVALID_ARGS, and no thread is founded', async () => {
    peer = await startConsultationPeer();
    await expect(ask(peer, '--ct', 'ask')).rejects.toMatchObject({ code: 'INVALID_ARGS' });
    await expect(ask(peer, '--ct', 'chat')).rejects.toMatchObject({ code: 'INVALID_ARGS' });
    await expect(ask(peer, '--brief', 'v1-to-v2.md')).rejects.toMatchObject({ code: 'INVALID_ARGS' });
    expect(peer.threads()).toHaveLength(0);
    expect(turnMock).not.toHaveBeenCalled();
  });

  it('[ac:ac-konsultacja-projektu-bez-wartosci-z-w] consulting a project whose registry has no `Wejście: konsultacja` value ends with PROJECT_WITHOUT_CONSULTATION, and no thread is founded', async () => {
    // A registry without the consultation row (`ask`).
    peer = await startConsultationPeer({ contextTypes: ['chat', 'brief', 'patch'] });
    await expect(ask(peer)).rejects.toMatchObject({ code: 'PROJECT_WITHOUT_CONSULTATION' });
    expect(peer.threads()).toHaveLength(0);
    expect(turnMock).not.toHaveBeenCalled();
  });
});
