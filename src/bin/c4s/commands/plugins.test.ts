/**
 * `c4s plugins` after item 25 moved it off its own loader.
 *
 * Driven against a real HTTP server rather than a stubbed function, for the same
 * reason the brief/patch family is: the point of the item is WHICH PROCESS
 * answers, so the URL the command calls is half the contract and a stubbed
 * module would assert neither the address nor the delegation.
 */

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseArgs } from '../args.js';
import { CliError } from '../errors.js';
import { WorkspaceRegistry } from '../../../server/workspace/registry.js';
import { __resetDelegateTargets } from '../delegate.js';
import { runPlugins } from './plugins.js';

const CONFIG = { name: 'test-project', roots: [], entitiesDir: 'entities', writingStyle: null, onboarding: {} };

describe('c4s plugins reports the server host\'s loader', () => {
  let registryDir: string;
  let projectDir: string;
  let prevHome: string | undefined;
  let stdout: string;
  let server: http.Server;
  let seen: string[];
  let reply: unknown;

  beforeEach(async () => {
    registryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-pl-registry-'));
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-pl-project-'));
    prevHome = process.env.C4S_HOME;
    process.env.C4S_HOME = registryDir;

    seen = [];
    reply = { hostApiVersion: '2.0.0', packages: [] };
    server = http.createServer((req, res) => {
      const url = req.url ?? '';
      res.setHeader('content-type', 'application/json');
      if (url.endsWith('/config')) return res.end(JSON.stringify(CONFIG));
      seen.push(url);
      res.end(JSON.stringify(reply));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;

    const registry = new WorkspaceRegistry(registryDir);
    const ws = registry.selectOrCreate({ name: 'default', port });
    registry.registerProject(ws, projectDir);
    __resetDelegateTargets();

    stdout = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      stdout += String(chunk);
      return true;
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    __resetDelegateTargets();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (prevHome === undefined) delete process.env.C4S_HOME;
    else process.env.C4S_HOME = prevHome;
    fs.rmSync(registryDir, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  const args = (...argv: string[]) =>
    parseArgs([...argv, '--project', path.basename(projectDir), '--workspace', 'default']);
  const printed = () => JSON.parse(stdout) as Record<string, unknown>;

  it('asks the server, and asks the route the UI reads', async () => {
    reply = {
      hostApiVersion: '2.0.0',
      packages: [
        { package: '@c4s/builtin', status: 'loaded', layer: 'base', contributedTypes: ['ac'] },
        { package: 'local-thing', status: 'loaded', layer: 'overlay', manifestVersion: '1.2.3', trust: 'trusted' },
      ],
    };
    await runPlugins(args('plugins', 'list'));
    expect(seen[0]).toMatch(/\/_meta\/plugins$/);
    expect(printed().packages).toEqual([
      { package: '@c4s/builtin', tier: 'base', version: null, contributedTypes: ['ac'] },
      { package: 'local-thing', tier: 'overlay', version: '1.2.3', contributedTypes: [] },
    ]);
  });

  it('status carries the untrusted-skipped label the trust prompt depends on', async () => {
    reply = {
      hostApiVersion: '2.0.0',
      packages: [
        { package: 'untrusted-one', status: 'skipped', code: 'PLUGIN_PROJECT_UNTRUSTED', reason: 'not trusted', layer: 'overlay', trust: 'untrusted' },
      ],
    };
    await runPlugins(args('plugins', 'status'));
    const rows = printed().packages as Array<Record<string, unknown>>;
    expect(rows[0]!.trust).toBe('untrusted-skipped');
    expect(rows[0]!.status).toBe('skipped');
  });

  it('doctor reports an engines miss, which the status filter used to drop', async () => {
    /**
     * The regression this closes. `gateManifest` records an `engines.node` miss
     * as `status: 'skipped'` — `'incompatible'` is reserved for a mismatch that
     * carries a migration descriptor, i.e. one with a repair path. `doctor`
     * filtered on that status, so the package the host had refused to load did
     * not appear in the report whose entire job is to say why a package did not
     * load, and the command exited 0 announcing `ok: true`.
     *
     * §9 of the brief names both codes as the aggregation's input, which is what
     * makes this the code's bug rather than the brief's.
     */
    reply = {
      hostApiVersion: '2.0.0',
      packages: [
        { package: 'needs-newer-node', status: 'skipped', code: 'PLUGIN_ENGINE_UNSATISFIED', reason: 'node 20.0.0 does not satisfy engines.node ">=22"', layer: 'base' },
      ],
    };
    await expect(runPlugins(args('plugins', 'doctor'))).rejects.toThrow(CliError);
    const rows = printed().incompatible as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.code).toBe('PLUGIN_ENGINE_UNSATISFIED');
    // An engines miss has no migration path, so `reason` is the only thing the
    // report can offer — without it the row would be a name and three nulls.
    expect(rows[0]!.reason).toMatch(/engines\.node/);
    expect(printed().ok).toBe(false);
  });

  it('[ac:ac-status-migracji-plugin-z-hostapiversio] doctor reads the same state `/api/_meta/plugins` carries, migration descriptor included', async () => {
    reply = {
      hostApiVersion: '2.0.0',
      packages: [
        { package: 'old-plugin', status: 'incompatible', code: 'PLUGIN_HOST_API_MISMATCH', reason: 'host API 2.0.0 does not satisfy plugin requirement "^1.0.0"', layer: 'base', migration: { targetHostApiVersion: '2.0.0', migrations: [], shimAvailable: false } },
      ],
    };
    await expect(runPlugins(args('plugins', 'doctor'))).rejects.toMatchObject({ code: 'HOST_API_INCOMPATIBLE' });
    const rows = printed().incompatible as Array<Record<string, unknown>>;
    expect(rows[0]!.builtAgainst).toMatch(/\^1\.0\.0/);
    expect(rows[0]!.migration).toMatchObject({ shimAvailable: false });
  });

  it('a clean host exits 0', async () => {
    reply = { hostApiVersion: '2.0.0', packages: [{ package: '@c4s/builtin', status: 'loaded', layer: 'base' }] };
    await runPlugins(args('plugins', 'doctor'));
    expect(printed().ok).toBe(true);
  });

  it('an unknown subcommand is refused before any request is made', async () => {
    await expect(runPlugins(args('plugins', 'wat'))).rejects.toMatchObject({ code: 'INVALID_ARGS' });
    expect(seen).toEqual([]);
  });
});
