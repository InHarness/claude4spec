import { describe, it, expect } from 'vitest';
import { buildTransagentToolsServer } from './transagent-tools.js';
import type { TransagentDispatcher } from '../services/transagent-dispatcher.js';
import { AgentTurnError } from '../../shared/agent-turn.js';
import { DomainError } from '../services/tags.js';

/**
 * `runTransagent`'s error taxonomy — the boundary where a CHILD turn's failure
 * becomes the parent's `tool_result`.
 *
 * Every case here is about a distinction that used to be lost. The handler
 * narrowed on `DomainError` alone, so the child turn's own `AgentTurnError`
 * codes — the ones that say whether a human stopped it, whether it ran out of
 * time, or whether it never started — all fell through to the default and
 * reached the parent agent as an undifferentiated `AGENT_ERROR`. A parent
 * cannot decide whether to retry from that.
 *
 * The tool is exercised through its real handler rather than through a spy on
 * the mapping helper: the collapse happened in the `catch`, which is the part
 * a unit test of the helper would not have run.
 */
describe('runTransagent — error taxonomy', () => {
  /** The tool, wired to a dispatcher that does nothing but throw `err`. */
  const toolThatThrows = (err: unknown) => {
    const dispatcher = {
      run: async () => {
        throw err;
      },
    } as unknown as TransagentDispatcher;
    const server = buildTransagentToolsServer({ parentThreadId: 'parent_1', dispatcher });
    const tool = server.tools.find((t) => t.name === 'runTransagent');
    if (!tool) throw new Error('runTransagent not registered');
    return tool;
  };

  const callAndParse = async (err: unknown) => {
    const result = (await toolThatThrows(err).handler({
      contextType: 'chat',
      message: 'go',
      planMode: false,
    })) as { isError?: boolean; content: Array<{ text: string }> };
    return {
      isError: result.isError,
      body: JSON.parse(result.content[0]!.text) as Record<string, unknown>,
    };
  };

  /**
   * The headline. `ABORTED` means a human pressed stop — retrying is the wrong
   * response, and `AGENT_ERROR` invites exactly that.
   */
  it('surfaces a child ABORTED as ABORTED, not AGENT_ERROR', async () => {
    const { isError, body } = await callAndParse(new AgentTurnError('ABORTED', 'Aborted by user'));
    expect(isError).toBe(true);
    expect(body.code).toBe('ABORTED');
    expect(body.error).toBe('Aborted by user');
  });

  it('surfaces a child TIMEOUT as TIMEOUT', async () => {
    const { body } = await callAndParse(new AgentTurnError('TIMEOUT', 'Agent took too long to respond'));
    expect(body.code).toBe('TIMEOUT');
  });

  /**
   * Not in the brief's list, and passed through deliberately: a child that
   * never started is the one failure worth retrying unchanged, and folding it
   * into `AGENT_ERROR` is what hides that. `ask` reports it for the same reason.
   */
  it('surfaces AGENT_UNAVAILABLE rather than folding it into AGENT_ERROR', async () => {
    const { body } = await callAndParse(new AgentTurnError('AGENT_UNAVAILABLE', 'no runtime'));
    expect(body.code).toBe('AGENT_UNAVAILABLE');
  });

  it('keeps a dispatcher NOT_FOUND as NOT_FOUND', async () => {
    const { body } = await callAndParse(new DomainError('NOT_FOUND', "child thread 'x' not found"));
    expect(body.code).toBe('NOT_FOUND');
  });

  /**
   * `VALIDATION` is the repo-wide SERVICE code for a bad argument; this tool's
   * documented contract says `INVALID_ARGS`. The rename happens at the tool
   * boundary so the service's vocabulary — shared with tags, entities and
   * everything else — is left alone.
   */
  it('renames a dispatcher VALIDATION to INVALID_ARGS', async () => {
    const { body } = await callAndParse(
      new DomainError('VALIDATION', "contextType='patch' requires payload.patchPath"),
    );
    expect(body.code).toBe('INVALID_ARGS');
  });

  /** A hint is the half of the error that says which call would have worked. */
  it('forwards a DomainError hint, which the handler used to drop', async () => {
    const { body } = await callAndParse(
      new DomainError('NOT_FOUND', 'no such thread', 'runTransagent({ threadId: "…" })'),
    );
    expect(body.hint).toBe('runTransagent({ threadId: "…" })');
  });

  /**
   * The default has to stay `AGENT_ERROR` rather than becoming `INTERNAL`: an
   * unrecognised throw from a child turn is still the child failing, not this
   * server faulting.
   */
  it('defaults an unrecognised error to AGENT_ERROR', async () => {
    const { body } = await callAndParse(new Error('kaboom'));
    expect(body.code).toBe('AGENT_ERROR');
    expect(body.error).toBe('kaboom');
  });

  it('reports a non-Error throw without losing its text', async () => {
    const { body } = await callAndParse('plain string failure');
    expect(body.code).toBe('AGENT_ERROR');
    expect(body.error).toBe('plain string failure');
  });

  /** The success path still returns the dispatcher's result verbatim. */
  it('returns { threadId, summary } unchanged when the child succeeds', async () => {
    const dispatcher = {
      run: async () => ({ threadId: 'child_1', summary: 'did the thing' }),
    } as unknown as TransagentDispatcher;
    const server = buildTransagentToolsServer({ parentThreadId: 'parent_1', dispatcher });
    const tool = server.tools.find((t) => t.name === 'runTransagent')!;
    const result = (await tool.handler({ contextType: 'chat', message: 'go', planMode: false })) as {
      isError?: boolean;
      content: Array<{ text: string }>;
    };
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.content[0]!.text)).toEqual({
      threadId: 'child_1',
      summary: 'did the thing',
    });
  });
});
