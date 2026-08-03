import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  normalizeResumePathScope,
  resolveAgentExecutionScope,
} from './agent-execution-scope.js';

/**
 * 0.2.8 (A19/C15): the shared scope builder. The path arithmetic itself is covered by
 * `agent-path-scope.test.ts`; what matters here is that config is read from disk PER CALL
 * (hot-reload) and that the `claude_sandbox` shape is derived from the same lists that go
 * to `adapter.execute`.
 */
describe('resolveAgentExecutionScope', () => {
  let cwd: string;

  const writeConfig = (cfg: Record<string, unknown>) => {
    fs.mkdirSync(path.join(cwd, '.claude4spec'), { recursive: true });
    fs.writeFileSync(path.join(cwd, '.claude4spec', 'config.json'), JSON.stringify(cfg));
  };

  beforeEach(() => {
    cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-exec-scope-')));
  });
  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it('always denies the artifact dirs, even with no config file at all', () => {
    const scope = resolveAgentExecutionScope({ cwd, roots: [] });
    for (const dir of ['plans', 'briefs', 'patches', 'entities', 'releases']) {
      expect(scope.disallowedPaths).toContain(path.join(cwd, '.claude4spec', dir));
    }
    expect(scope.artifactDenyDirs).toHaveLength(5);
    expect(scope.userAllowedPaths).toEqual([]);
    expect(scope.userDisallowedPaths).toEqual([]);
  });

  it('folds the user lists in and exposes them raw for the prompt layer', () => {
    writeConfig({ agent: { allowedPaths: ['src'], disallowedPaths: ['secrets'] } });
    const scope = resolveAgentExecutionScope({ cwd, roots: [] });
    expect(scope.allowedPaths).toContain(path.join(cwd, 'src'));
    expect(scope.disallowedPaths).toContain(path.join(cwd, 'secrets'));
    // The soft (prompt) layer renders the config lists verbatim, not the resolved ones.
    expect(scope.userAllowedPaths).toEqual(['src']);
    expect(scope.userDisallowedPaths).toEqual(['secrets']);
  });

  it('re-reads config on every call (hot-reload, no start-up cache)', () => {
    writeConfig({ agent: { allowedPaths: ['before'] } });
    const first = resolveAgentExecutionScope({ cwd, roots: [] });
    expect(first.allowedPaths).toEqual([path.join(cwd, 'before')]);

    writeConfig({ agent: { allowedPaths: ['after'] } });
    const second = resolveAgentExecutionScope({ cwd, roots: [] });
    expect(second.allowedPaths).toEqual([path.join(cwd, 'after')]);
  });

  it('honours custom artifact dir locations from config', () => {
    writeConfig({ briefsDir: 'docs/briefs' });
    const scope = resolveAgentExecutionScope({ cwd, roots: [] });
    expect(scope.disallowedPaths).toContain(path.join(cwd, 'docs', 'briefs'));
    expect(scope.disallowedPaths).not.toContain(path.join(cwd, '.claude4spec', 'briefs'));
  });

  it('derives claude_sandbox from the same resolved lists', () => {
    writeConfig({ agent: { allowedPaths: ['src'], disallowedPaths: ['secrets'] } });
    const scope = resolveAgentExecutionScope({ cwd, roots: [] });
    expect(scope.claudeSandbox).toEqual({
      enabled: true,
      filesystem: {
        denyRead: scope.disallowedPaths,
        denyWrite: scope.disallowedPaths,
        allowWrite: scope.allowedPaths,
      },
    });
  });
});

describe('normalizeResumePathScope', () => {
  it('sorts, so a reorder of the same paths compares equal', () => {
    const a = normalizeResumePathScope(['/b', '/a', '/c']);
    const b = normalizeResumePathScope(['/c', '/b', '/a']);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('dedupes', () => {
    expect(normalizeResumePathScope(['/a', '/a', '/b'])).toEqual(['/a', '/b']);
  });

  it('leaves an empty list empty', () => {
    expect(normalizeResumePathScope([])).toEqual([]);
  });
});
