import { describe, expect, it } from 'vitest';
import { CliError, cliErrorFromDiscovery } from './errors.js';
import { DiscoveryError } from '../../server/discovery/index.js';

describe('CliError', () => {
  it('exposes name, code and message', () => {
    const err = new CliError('ENTITY_NOT_FOUND', 'entity not found');
    expect(err.name).toBe('CliError');
    expect(err.code).toBe('ENTITY_NOT_FOUND');
    expect(err.message).toBe('entity not found');
    expect(err.hint).toBeUndefined();
  });

  it('carries an optional hint', () => {
    const err = new CliError('INVALID_ARGS', 'bad args', 'try --help');
    expect(err.hint).toBe('try --help');
  });

  it('is an instance of Error and CliError', () => {
    const err = new CliError('TIMEOUT', 'took too long');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(CliError);
  });
});

/**
 * 0.2.3 M39 — the safety net for a core error nobody anticipated.
 *
 * Every `c4s` command converts its own failures today, so this path is not on
 * the happy route — which is exactly why it needs a test. Untested and
 * unreachable, it would rot into "we handle that" while the bin kept reporting
 * `UNKNOWN_COMMAND` and discarding the one thing a caller could act on.
 */
describe('cliErrorFromDiscovery', () => {
  it("keeps the core's code, message and repair path", () => {
    const mapped = cliErrorFromDiscovery(
      new DiscoveryError('PAGE_NOT_FOUND', "no page 'x.md' in root 'pages'", 'roots in this project: pages'),
    );
    expect(mapped).toBeInstanceOf(CliError);
    expect(mapped).toMatchObject({
      code: 'PAGE_NOT_FOUND',
      message: "no page 'x.md' in root 'pages'",
      hint: 'roots in this project: pages',
    });
  });

  it("carries INVALID_ARGUMENT rather than collapsing it into the CLI's own INVALID_ARGS", () => {
    // The two mean different things: one is "you typed the flags wrong", the
    // other carries a correction from the core. Merging them loses the hint.
    const mapped = cliErrorFromDiscovery(
      new DiscoveryError('INVALID_ARGUMENT', 'get_page requires rootId', 'get_page({ rootId: "pages", … })'),
    );
    expect(mapped?.code).toBe('INVALID_ARGUMENT');
    expect(mapped?.hint).toContain('rootId');
  });

  it('returns null for anything else, so the caller keeps its own fallback', () => {
    expect(cliErrorFromDiscovery(new Error('boom'))).toBeNull();
    expect(cliErrorFromDiscovery(new CliError('UNKNOWN_COMMAND', 'nope'))).toBeNull();
    expect(cliErrorFromDiscovery('a string')).toBeNull();
    expect(cliErrorFromDiscovery(undefined)).toBeNull();
  });
});
