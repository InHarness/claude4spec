import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { markBriefImplemented } from './mark-brief-implemented.js';
import { AgentError } from './run-agent.js';
import { WorkspaceRegistry } from '../../server/workspace/registry.js';

const VALID_CONFIG = {
  name: 'peer',
  roots: [
    {
      id: 'pages',
      name: 'Pages',
      dir: 'pages',
      builtin: true,
      releasable: true,
      sectionIndexed: true,
      referenceValidated: true,
      linkTargets: [],
      sidebar: 'accordion',
      briefTarget: true,
    },
  ],
  entitiesDir: 'entities',
  writingStyle: null,
  onboarding: {},
};

/** Routes /config then /frontmatter by URL, recording each request's method + body. */
function stubFlow(frontmatterResponse: { status: number; ok: boolean; body: unknown }): {
  calls: Array<{ url: string; method?: string; body: unknown }>;
} {
  const calls: Array<{ url: string; method?: string; body: unknown }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      const body = init?.body ? JSON.parse(init.body) : undefined;
      calls.push({ url, method: init?.method, body });
      if (url.endsWith('/config')) {
        return { status: 200, ok: true, json: async () => VALID_CONFIG };
      }
      return {
        status: frontmatterResponse.status,
        ok: frontmatterResponse.ok,
        json: async () => frontmatterResponse.body,
      };
    }),
  );
  return { calls };
}

describe('markBriefImplemented', () => {
  let dir: string;
  let prevHome: string | undefined;
  let projectDir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-mbi-'));
    prevHome = process.env.C4S_HOME;
    process.env.C4S_HOME = dir;
    projectDir = path.join(dir, 'spec-project');
    fs.mkdirSync(projectDir, { recursive: true });
    const registry = new WorkspaceRegistry(dir);
    const ws = registry.selectOrCreate({ name: 'default', port: 4531 });
    registry.registerProject(ws, projectDir);
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.C4S_HOME;
    else process.env.C4S_HOME = prevHome;
    fs.rmSync(dir, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  it('PATCHes the frontmatter endpoint with { implemented: true } and returns the DTO', async () => {
    const { calls } = stubFlow({
      status: 200,
      ok: true,
      body: { data: { path: 'v0-1-16-to-v0-1-17.md', implemented: true } },
    });

    const result = await markBriefImplemented({
      briefPath: 'v0-1-16-to-v0-1-17.md',
      project: projectDir,
      workspace: 'default',
    });

    expect(result).toEqual({ path: 'v0-1-16-to-v0-1-17.md', implemented: true });
    const patch = calls.find((c) => c.url.endsWith('/frontmatter'));
    expect(patch?.method).toBe('PATCH');
    expect(patch?.url).toContain('/briefs/v0-1-16-to-v0-1-17.md/frontmatter');
    expect(patch?.body).toEqual({ implemented: true });
  });

  it('URL-encodes each path segment of a nested brief path', async () => {
    const { calls } = stubFlow({ status: 200, ok: true, body: { data: {} } });

    await markBriefImplemented({ briefPath: 'sub dir/brief one.md', project: projectDir, workspace: 'default' });

    const patch = calls.find((c) => c.url.endsWith('/frontmatter'));
    expect(patch?.url).toContain('/briefs/sub%20dir/brief%20one.md/frontmatter');
  });

  it('surfaces SERVER_NOT_RUNNING when the health-check fails to connect', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    );

    const err = await markBriefImplemented({ briefPath: 'x.md', project: projectDir, workspace: 'default' }).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(AgentError);
    expect((err as AgentError).code).toBe('SERVER_NOT_RUNNING');
  });

  it('does NOT report SERVER_NOT_RUNNING for a PATCH client-side timeout — the health-check already confirmed the server is up', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/config')) {
          return { status: 200, ok: true, json: async () => VALID_CONFIG };
        }
        const err = new Error('fetch failed');
        (err as unknown as { cause: { code: string } }).cause = { code: 'UND_ERR_HEADERS_TIMEOUT' };
        throw err;
      }),
    );

    const err = await markBriefImplemented({ briefPath: 'x.md', project: projectDir, workspace: 'default' }).catch(
      (e) => e,
    );
    expect(err).not.toBeInstanceOf(AgentError);
    expect((err as Error).message).toBe('fetch failed');
  });

  it('translates a 404 (generic NOT_FOUND envelope) into BRIEF_NOT_FOUND', async () => {
    stubFlow({
      status: 404,
      ok: false,
      body: { error: { code: 'NOT_FOUND', message: 'brief not found: missing.md' } },
    });

    const err = await markBriefImplemented({
      briefPath: 'missing.md',
      project: projectDir,
      workspace: 'default',
    }).catch((e) => e);
    expect(err).toBeInstanceOf(AgentError);
    expect((err as AgentError).code).toBe('BRIEF_NOT_FOUND');
    expect((err as AgentError).message).toBe('brief not found: missing.md');
  });

  it('passes through BRIEF_FRONTMATTER_IMMUTABLE unchanged', async () => {
    stubFlow({
      status: 400,
      ok: false,
      body: {
        error: {
          code: 'BRIEF_FRONTMATTER_IMMUTABLE',
          message: "cannot mutate immutable frontmatter keys: source (only 'implemented' is mutable via this endpoint)",
        },
      },
    });

    const err = await markBriefImplemented({ briefPath: 'x.md', project: projectDir, workspace: 'default' }).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(AgentError);
    expect((err as AgentError).code).toBe('BRIEF_FRONTMATTER_IMMUTABLE');
  });
});
