import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceRegistry } from '../server/workspace/registry.js';
import { applyNetworkFlags } from '../server/workspace/network-flags.js';
import { parseLaunchArgs, printStartWarnings, workspaceOnlyLaunch } from './launch.js';

/**
 * 2.1.12 — M31 edge cases of the launcher (`npx claude4spec`): the bare command
 * and the start warnings of a listen address beyond loopback.
 */
describe('claude4spec launcher — M31 edge cases', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-launch-'));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('[ac:ac-gola-komenda-uruchomiona-w-katalogu-z] the bare command in a directory with an existing .claude4spec/config.json does not register it', () => {
    const repo = path.join(tmp, 'repo');
    fs.mkdirSync(path.join(repo, '.claude4spec'), { recursive: true });
    const configPath = path.join(repo, '.claude4spec', 'config.json');
    const config = JSON.stringify({ $schemaVersion: 4, name: 'Already Here' });
    fs.writeFileSync(configPath, config);
    const registry = new WorkspaceRegistry(path.join(tmp, 'home'));

    // Bare: no flag at all, run from inside the repo.
    const args = parseLaunchArgs([], repo);
    expect(args.cwd).toBe(repo);
    expect(args.createProject).toBe(false);

    const ws = workspaceOnlyLaunch(registry, args);
    const stored = registry.getWorkspace(ws.name)!;
    expect(stored.projects).toEqual([]);
    expect(stored.projects.some((p) => p.cwd === repo)).toBe(false);
    // Nothing is written into the CWD either.
    expect(fs.readFileSync(configPath, 'utf8')).toBe(config);
    expect(fs.readdirSync(path.join(repo, '.claude4spec'))).toEqual(['config.json']);

    // Contrast: an explicit opt-in is what registers a directory.
    expect(parseLaunchArgs(['--create-project'], repo).createProject).toBe(true);
    expect(parseLaunchArgs(['--cwd', '.'], repo).createProject).toBe(true);
  });

  it('[ac:ac-start-z-nasluchem-poza-loopbackiem-i] a start listening beyond loopback with no publicUrl warns that handed-out addresses will point at localhost', () => {
    const registry = new WorkspaceRegistry(path.join(tmp, 'home'));
    const base = workspaceOnlyLaunch(registry, { port: 4590 });
    const ws = applyNetworkFlags(registry, base, { host: '0.0.0.0' });
    expect(ws.publicUrl).toBeUndefined();

    const printed: string[] = [];
    const warnings = printStartWarnings(ws, (line) => printed.push(line));
    const localhostWarning = printed.find((l) => l.includes('no public URL is set'));
    expect(localhostWarning).toBeDefined();
    expect(localhostWarning).toContain('http://localhost:4590');
    expect(localhostWarning).toContain('MCP connection snippets');
    expect(warnings).toHaveLength(2); // + the no-authentication warning

    // The attribute persists, so the NEXT start (fresh read, no flags) warns again.
    const next = registry.getWorkspace(ws.name)!;
    expect(printStartWarnings(next, () => {}).some((w) => w.includes('localhost:4590'))).toBe(true);

    // An explicit publicUrl silences it; loopback never raises it.
    const withUrl = applyNetworkFlags(registry, next, { publicUrl: 'https://spec.example.com' });
    expect(printStartWarnings(withUrl, () => {}).some((w) => w.includes('no public URL'))).toBe(false);
    expect(printStartWarnings({ defaultPort: 4590 }, () => {})).toEqual([]);
  });
});
