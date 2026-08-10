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
