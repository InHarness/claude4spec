import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CliError, cliErrorFromDiscovery, codeToExit, type CliErrorCode } from './errors.js';
import { DiscoveryError, type DiscoveryErrorCode } from '../../server/discovery/index.js';
import { SHARED_RESOLVER_CODES } from './registry.js';
import { askCommand } from './commands/ask.js';
import { agentCommand } from './commands/agent.js';
import type { AgentErrorCode } from '../../core/agent/run-agent.js';

/** The literal members of the `CliErrorCode` union, read from its declaration. */
function cliErrorCodeUnion(): string[] {
  const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'errors.ts'), 'utf8');
  const decl = /export type CliErrorCode =([\s\S]*?)\n\nexport class/.exec(src)![1]!;
  // Drop comment lines first: a comment may NAME a removed code.
  const code = decl
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');
  return [...code.matchAll(/\|\s*'([A-Z_]+)'/g)].map((m) => m[1]!);
}

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

/**
 * 2.1.26 (M11 L14 `ihakwlks`) — the codes the dispatcher MAPS from the M39 core
 * catalogue: ENTITY_NOT_FOUND / SECTION_NOT_FOUND / PAGE_NOT_FOUND /
 * INVALID_TYPE / INVALID_ARGUMENT / INDEX_STALE / SEARCH_BUDGET_EXCEEDED. The
 * ambiguity codes left the list; the selector ambiguities stay M11's own.
 */
describe('the CLI error catalogue (2.1.26)', () => {
  const CORE_MAPPED = [
    'ENTITY_NOT_FOUND',
    'SECTION_NOT_FOUND',
    'PAGE_NOT_FOUND',
    'INVALID_TYPE',
    'INVALID_ARGUMENT',
    'INDEX_STALE',
    'SEARCH_BUDGET_EXCEEDED',
  ] as const satisfies readonly (CliErrorCode & DiscoveryErrorCode)[];

  it('[section:ihakwlks] maps the core codes — INDEX_STALE and SEARCH_BUDGET_EXCEEDED included — under the core\'s own names, hint kept', () => {
    const union = cliErrorCodeUnion();
    for (const code of CORE_MAPPED) {
      expect(union, code).toContain(code);
      const mapped = cliErrorFromDiscovery(new DiscoveryError(code, `${code} happened`, `repair ${code}`));
      expect(mapped, code).toBeInstanceOf(CliError);
      expect(mapped, code).toMatchObject({ code, message: `${code} happened`, hint: `repair ${code}` });
    }
  });

  it('[section:ihakwlks] has no core ambiguity code — AMBIGUOUS_SLUGS, AMBIGUOUS_ENTITY and AMBIGUOUS_PAGE are gone, without an exit code of their own', () => {
    const union = cliErrorCodeUnion();
    // A parse that found nothing would pass the negative assertions vacuously.
    expect(union.length).toBeGreaterThan(40);
    for (const gone of ['AMBIGUOUS_SLUGS', 'AMBIGUOUS_ENTITY', 'AMBIGUOUS_PAGE']) {
      expect(union, gone).not.toContain(gone);
      // Exit 20 / 21 went with them: an unknown code falls to the generic 1.
      expect(codeToExit(gone), gone).toBe(1);
    }
    // @ts-expect-error — removed from the union in 2.1.26.
    new CliError('AMBIGUOUS_ENTITY', 'x');
    // @ts-expect-error — removed from the union in 2.1.26.
    new CliError('AMBIGUOUS_SLUGS', 'x');
    // The workspace/project selector ambiguities are M11's own and stay, exit 7.
    expect(union).toEqual(expect.arrayContaining(['AMBIGUOUS_WORKSPACE', 'AMBIGUOUS_PROJECT']));
    expect(codeToExit('AMBIGUOUS_WORKSPACE')).toBe(7);
    expect(codeToExit('AMBIGUOUS_PROJECT')).toBe(7);
  });
});

/**
 * 2.1.26 (M11 L2 `m11dcore`) — `runAgent`'s rejected-promise codes are the same
 * fifteen for both transports, in three groups: 7 local, 6 HTTP-derived (now
 * with RESUME_CONFIG_LOCKED, the 409 for a changed session config), 2 from the
 * turn body. `c4s ask` declares exactly those fifteen.
 */
describe('the agent-turn code catalogue (2.1.26)', () => {
  const LOCAL = [
    'PROJECT_NOT_FOUND',
    'PROJECT_ID_NOT_FOUND',
    'AMBIGUOUS_WORKSPACE',
    'AMBIGUOUS_PROJECT',
    'SERVER_NOT_RUNNING',
    'SERVER_NOT_RECOGNIZED',
    'INVALID_ARGS',
  ] as const satisfies readonly AgentErrorCode[];
  const HTTP = [
    'PROJECT_NOT_IN_WORKSPACE',
    'NOT_FOUND',
    'STREAM_IN_PROGRESS',
    'RESUME_CONFIG_LOCKED',
    'AGENT_UNAVAILABLE',
    'AGENT_ERROR',
  ] as const satisfies readonly AgentErrorCode[];
  const LIFECYCLE = ['TIMEOUT', 'ABORTED'] as const satisfies readonly AgentErrorCode[];

  it('[section:m11dcore] fifteen codes in three groups (7 + 6 + 2), and `c4s ask` declares exactly them', () => {
    const all = [...LOCAL, ...HTTP, ...LIFECYCLE];
    expect([LOCAL.length, HTTP.length, LIFECYCLE.length]).toEqual([7, 6, 2]);
    expect(new Set(all).size).toBe(15);
    const declared = new Set([...SHARED_RESOLVER_CODES, ...askCommand.errorCodes]);
    expect([...declared].sort()).toEqual([...all].sort());
  });

  it('[section:g24dkd8t] RESUME_CONFIG_LOCKED is a CLI code of both turn commands, on the generic exit', () => {
    expect(cliErrorCodeUnion()).toContain('RESUME_CONFIG_LOCKED');
    expect(askCommand.errorCodes).toContain('RESUME_CONFIG_LOCKED');
    expect(agentCommand.errorCodes).toContain('RESUME_CONFIG_LOCKED');
    expect(codeToExit('RESUME_CONFIG_LOCKED')).toBe(1);
    // `c4s ask` renders the catalog operation `ask` (its record's `cli: direct`).
    expect(askCommand.operation).toBe('ask');
    expect(askCommand.executionMode).toBe('server-delegating');
  });
});

/**
 * 2.1.53 — the explicit table of environment codes and their exits. Exit 8 is
 * the one class fixed by a single command (start the server); every "no such
 * project" is exit 1; an unmapped code falls to a generic non-zero exit.
 */
describe('environment codes → exit statuses (2.1.53)', () => {
  it('[section:m11dcore] maps the environment table exactly', () => {
    expect(codeToExit('PROJECT_NOT_FOUND')).toBe(1);
    expect(codeToExit('PROJECT_ID_NOT_FOUND')).toBe(1);
    expect(codeToExit('PROJECT_NOT_IN_WORKSPACE')).toBe(1);
    expect(codeToExit('AMBIGUOUS_WORKSPACE')).toBe(7);
    expect(codeToExit('AMBIGUOUS_PROJECT')).toBe(7);
    expect(codeToExit('SERVER_NOT_RUNNING')).toBe(8);
    expect(codeToExit('SERVER_NOT_RECOGNIZED')).toBe(8);
    expect(codeToExit('SOMETHING_UNMAPPED')).toBeGreaterThan(0);
  });

  it('[section:m11dcore] ROOT_NOT_FOUND is no longer a CLI code', () => {
    expect(cliErrorCodeUnion()).not.toContain('ROOT_NOT_FOUND');
  });
});
