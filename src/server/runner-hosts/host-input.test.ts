import { describe, expect, it } from 'vitest';
import {
  hostEndpoint,
  MASTER_TOKEN_PREFIX,
  normalizeHostUrl,
  normalizeMasterToken,
  RunnerHostError,
  tokenLast4,
} from './host-input.js';

function refusal(fn: () => unknown): RunnerHostError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(RunnerHostError);
    return err as RunnerHostError;
  }
  throw new Error('expected a refusal');
}

describe('M54 host address (kqxtylk6)', () => {
  it('[section:kqxtylk6] normalizes: lower-case scheme and host, IDN to punycode, no default port, no trailing slash, path prefix kept', () => {
    expect(normalizeHostUrl('  HTTP://Runner.Example.COM:80/  ')).toBe('http://runner.example.com');
    expect(normalizeHostUrl('https://runner.example.com:443')).toBe('https://runner.example.com');
    expect(normalizeHostUrl('http://runner.local:7000/')).toBe('http://runner.local:7000');
    expect(normalizeHostUrl('https://proxy.example.com/c4s/runner-a/')).toBe('https://proxy.example.com/c4s/runner-a');
    expect(normalizeHostUrl('http://bücher.example')).toBe('http://xn--bcher-kva.example');
    expect(normalizeHostUrl('http://127.0.0.1:7000')).toBe('http://127.0.0.1:7000');
    expect(normalizeHostUrl('http://[::1]:7000/')).toBe('http://[::1]:7000');
  });

  it('[section:kqxtylk6] refuses a non-http(s) scheme, a query, a fragment, userinfo and garbage with VALIDATION on the url field', () => {
    for (const bad of [
      'ftp://runner.local',
      'runner.local:7000',
      'not a url',
      '',
      'http://runner.local/?a=1',
      'http://runner.local/?',
      'http://runner.local/#x',
      'http://runner.local#',
      'http://user:pw@runner.local',
      'http://user@runner.local',
      'http://@runner.local',
    ]) {
      const err = refusal(() => normalizeHostUrl(bad));
      expect(err.code, bad).toBe('VALIDATION');
      expect(err.field, bad).toBe('url');
    }
  });

  it('[section:kqxtylk6] refuses an unspecified address (0.0.0.0, ::) in every spelling the parser folds into it', () => {
    for (const bad of ['http://0.0.0.0:7000', 'http://0:7000', 'http://[::]:7000', 'http://[0:0::0]:7000/']) {
      const err = refusal(() => normalizeHostUrl(bad));
      expect(err.code, bad).toBe('VALIDATION');
      expect(err.message, bad).toMatch(/unspecified/);
    }
  });

  it('[section:kqxtylk6] appends a contract path to the base address without a double slash, keeping the path prefix', () => {
    expect(hostEndpoint('http://runner.local:7000', '/host')).toBe('http://runner.local:7000/host');
    expect(hostEndpoint('https://proxy.example.com/c4s', 'host/events')).toBe('https://proxy.example.com/c4s/host/events');
    expect(hostEndpoint('https://proxy.example.com/c4s/', '/host/events')).toBe(
      'https://proxy.example.com/c4s/host/events',
    );
  });
});

describe('M54 secret boundary — token input (qc6t2y7m)', () => {
  const token = `${MASTER_TOKEN_PREFIX}AbCdEfGh0123456789`;

  it('[section:qc6t2y7m] trims whitespace and keeps a printable-ASCII token with the master prefix; last4 is its last four characters', () => {
    expect(MASTER_TOKEN_PREFIX).toBe('c4sr_');
    expect(normalizeMasterToken(`  ${token}\n\t`)).toBe(token);
    expect(tokenLast4(token)).toBe('6789');
  });

  it('[section:qc6t2y7m] refuses an empty token, a non-printable-ASCII character and a missing prefix — and the refusal never echoes the token', () => {
    const cases = ['', '   ', `${token}\u0007x`, `c4sr_zażółć`, 'ghp_AbCdEfGh0123456789', 'C4SR_AbCdEfGh0123456789'];
    for (const bad of cases) {
      const err = refusal(() => normalizeMasterToken(bad));
      expect(err.code).toBe('VALIDATION');
      expect(err.field).toBe('token');
      if (bad.trim()) expect(err.message).not.toContain(bad.trim());
    }
  });
});
