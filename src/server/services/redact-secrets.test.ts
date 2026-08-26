import { describe, it, expect } from 'vitest';
import { redactSecrets, REDACTED } from './redact-secrets.js';

/**
 * The one caller logs the adapter's `sdkConfig` — a library-shaped object whose
 * contents we do not control and which carries a decrypted API key whenever the
 * project uses a stored credential.
 */
describe('redactSecrets', () => {
  it('redacts every value under custom_env while keeping the key names visible', () => {
    const out = redactSecrets({
      custom_env: { ANTHROPIC_API_KEY: 'sk-ant-live', PATH: '/usr/bin' },
    }) as { custom_env: Record<string, string> };

    // Which env vars were set is useful and is not itself a secret; the values are.
    expect(Object.keys(out.custom_env).sort()).toEqual(['ANTHROPIC_API_KEY', 'PATH']);
    expect(out.custom_env.ANTHROPIC_API_KEY).toBe(REDACTED);
    // PATH is redacted too — an arbitrary env block is suspect wholesale, and we
    // cannot predict which of its names carry secrets.
    expect(out.custom_env.PATH).toBe(REDACTED);
  });

  it('redacts secret-shaped keys at any depth', () => {
    const out = redactSecrets({
      model: 'opus',
      nested: { apiKey: 'a', authToken: 'b', deep: { clientSecret: 'c', harmless: 'keep' } },
    }) as Record<string, Record<string, unknown>>;

    expect(out.model).toBe('opus');
    expect(out.nested.apiKey).toBe(REDACTED);
    expect(out.nested.authToken).toBe(REDACTED);
    expect((out.nested.deep as Record<string, unknown>).clientSecret).toBe(REDACTED);
    expect((out.nested.deep as Record<string, unknown>).harmless).toBe('keep');
  });

  it('walks arrays without losing their shape', () => {
    const out = redactSecrets({ servers: [{ name: 'a', token: 't' }] }) as {
      servers: Array<Record<string, unknown>>;
    };

    expect(out.servers).toHaveLength(1);
    expect(out.servers[0].name).toBe('a');
    expect(out.servers[0].token).toBe(REDACTED);
  });

  /**
   * This runs inside a log path. A stack overflow while trying to WRITE a log
   * line would take the turn down — a far worse outcome than an imperfect line.
   */
  it('survives a cyclic object instead of overflowing the stack', () => {
    const cyclic: Record<string, unknown> = { name: 'root' };
    cyclic.self = cyclic;

    expect(() => redactSecrets(cyclic)).not.toThrow();
    expect((redactSecrets(cyclic) as Record<string, unknown>).self).toBe('[circular]');
  });

  it('passes primitives through untouched', () => {
    expect(redactSecrets('plain')).toBe('plain');
    expect(redactSecrets(42)).toBe(42);
    expect(redactSecrets(null)).toBe(null);
  });
});

/**
 * A repeated reference is not a cycle. `sdkConfig` shapes commonly point two
 * keys at the same options object; a plain visited-set rendered the second
 * occurrence as `'[circular]'`, which both hides a whole subtree and asserts a
 * cycle that does not exist.
 */
it('renders a shared (non-cyclic) reference twice rather than calling it circular', () => {
  const shared = { model: 'opus', nested: { keep: 'visible' } };
  const out = redactSecrets({ a: shared, b: shared }) as Record<string, unknown>;

  expect(out.a).toEqual({ model: 'opus', nested: { keep: 'visible' } });
  expect(out.b).toEqual({ model: 'opus', nested: { keep: 'visible' } });
  expect(JSON.stringify(out)).not.toContain('[circular]');
});

/** A genuine cycle must still terminate — this runs in a log path. */
it('still short-circuits a real cycle', () => {
  const cyclic: Record<string, unknown> = { name: 'root' };
  cyclic.self = cyclic;

  const out = redactSecrets(cyclic) as Record<string, unknown>;

  expect(out.name).toBe('root');
  // The back-edge is caught on the ANCESTOR path, so the self-reference itself
  // is what renders as the marker.
  expect(out.self).toBe('[circular]');
});
