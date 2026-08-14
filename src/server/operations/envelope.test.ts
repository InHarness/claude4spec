import { afterEach, describe, expect, it, vi } from 'vitest';
import { toolSuccess } from './envelope.js';

/**
 * The response-size instrumentation, which exists so the echo-free rule is
 * falsifiable at runtime rather than merely asserted in a brief.
 */
describe('response-size telemetry', () => {
  afterEach(() => {
    delete process.env.C4S_RESPONSE_SIZE;
    vi.restoreAllMocks();
  });

  it('is silent unless explicitly enabled', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    toolSuccess({ hash: 'abc' }, { operation: 'update_page', channel: 'mcp' });
    expect(log).not.toHaveBeenCalled();
  });

  it('reports the operation, the channel and the size in characters of serialized JSON', () => {
    process.env.C4S_RESPONSE_SIZE = '1';
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const payload = { anchor: 'aaaa1111', hash: 'f'.repeat(64), version: 3, affectedAnchors: [] };
    toolSuccess(payload, { operation: 'update_sections', channel: 'mcp' });
    expect(log).toHaveBeenCalledWith(
      `[response-size] update_sections mcp ${JSON.stringify(payload).length}`,
    );
  });

  it('measures the string it actually returned, so the log cannot drift from the wire', () => {
    process.env.C4S_RESPONSE_SIZE = '1';
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const env = toolSuccess({ a: 1, b: [1, 2, 3] }, { operation: 'x', channel: 'mcp' });
    const reported = Number(String(log.mock.calls[0]?.[0]).split(' ').pop());
    expect(reported).toBe(env.content[0]!.text.length);
  });

  it('never lets the context leak into the envelope', () => {
    process.env.C4S_RESPONSE_SIZE = '1';
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const env = toolSuccess({ hash: 'abc' }, { operation: 'update_page', channel: 'mcp' });
    // The wire shape is the channel's and stays exactly what it was before the
    // instrumentation existed — that is the whole reason `ctx` is a parameter
    // rather than a field.
    expect(env).toEqual({ content: [{ type: 'text', text: '{"hash":"abc"}' }] });
    expect(env.content[0]!.text).not.toContain('update_page');
  });

  it('still answers when a caller has not been instrumented yet', () => {
    process.env.C4S_RESPONSE_SIZE = '1';
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const env = toolSuccess({ ok: true });
    expect(env.content[0]!.text).toBe('{"ok":true}');
    expect(log).toHaveBeenCalledWith('[response-size] unknown unknown 11');
  });
});

/**
 * The payload guard — `JSON.stringify` has two ways to turn a successful
 * operation into a tool call that answers nothing at all, and both landed in the
 * same "MCP went silent" bucket as brief `0-2-23-to-next`'s root cause.
 */
describe('toolSuccess payload guard', () => {
  afterEach(() => {
    delete process.env.C4S_RESPONSE_SIZE;
    vi.restoreAllMocks();
  });

  it('serializes undefined data to `null` rather than an envelope with no text', () => {
    const env = toolSuccess(undefined, { operation: 'x', channel: 'mcp' });
    // Before the guard this was `text: undefined` — a `ToolEnvelope` whose own
    // type says `string`, which MCP validation drops without a word.
    expect(env.content[0]!.text).toBe('null');
    expect(env.isError).toBeUndefined();
  });

  it('measures the guarded string, so telemetry cannot report a length it never sent', () => {
    process.env.C4S_RESPONSE_SIZE = '1';
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const env = toolSuccess(undefined, { operation: 'x', channel: 'mcp' });
    const reported = Number(String(log.mock.calls[0]?.[0]).split(' ').pop());
    expect(reported).toBe(env.content[0]!.text.length);
  });

  it('refuses a Promise instead of quietly reporting `{}` success', () => {
    const env = toolSuccess(Promise.resolve({ real: 'data' }), { operation: 'x', channel: 'mcp' });
    expect(env.isError).toBe(true);
    const body = JSON.parse(env.content[0]!.text) as { code: string; hint?: string };
    expect(body.code).toBe('INTERNAL');
    expect(body.hint).toContain('await');
  });

  it('turns a cyclic payload into an error envelope rather than a throw', () => {
    const cyclic: Record<string, unknown> = { name: 'loop' };
    cyclic.self = cyclic;
    const env = toolSuccess(cyclic, { operation: 'x', channel: 'mcp' });
    expect(env.isError).toBe(true);
    expect(env.content[0]!.text).toContain('circular');
  });

  it('leaves ordinary payloads byte-identical — the guard is not a re-serialization', () => {
    expect(toolSuccess({ hash: 'abc' }).content[0]!.text).toBe('{"hash":"abc"}');
    expect(toolSuccess([1, 2, 3]).content[0]!.text).toBe('[1,2,3]');
    expect(toolSuccess(null).content[0]!.text).toBe('null');
    expect(toolSuccess(0).content[0]!.text).toBe('0');
    expect(toolSuccess('').content[0]!.text).toBe('""');
  });
});
