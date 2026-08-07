import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceRegistry } from './registry.js';
import { bootstrapProject } from './bootstrap.js';
import { mcpJsonPath } from '../mcp/ensure-mcp-json.js';

/**
 * 0.2.13 — `.claude4spec/mcp.json` names the project's MCP mount point, so it
 * cannot be written before the project HAS an id.
 *
 * `ensureMcpJson` used to be called above `registry.registerProject`, which was
 * fine while the file carried only a path and a workspace name. Moving the call
 * is the kind of change that unit tests over `renderMcpJson` cannot catch — it
 * would render a perfectly valid entry pointing at `undefined`. This test is
 * over the real boot order, for that reason.
 */
describe('bootstrapProject writes mcp.json after the project is registered', () => {
  let dir: string;
  let cwd: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-boot-mcp-'));
    cwd = path.join(dir, 'project');
    fs.mkdirSync(cwd, { recursive: true });
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const boot = () => {
    const registry = new WorkspaceRegistry(dir);
    const ws = registry.selectOrCreate({ name: 'default' });
    return { result: bootstrapProject(registry, ws, cwd), ws };
  };

  const readEntry = () =>
    JSON.parse(fs.readFileSync(mcpJsonPath(cwd), 'utf8')).mcpServers['c4s-spec-reader'] as {
      type: string;
      url: string;
    };

  it('points the URL at the id the registry actually assigned', () => {
    const { result, ws } = boot();
    const entry = readEntry();

    expect(entry.type).toBe('http');
    expect(entry.url).toBe(`http://127.0.0.1:${ws.defaultPort}/api/projects/${result.project.id}/mcp`);
    // The failure mode of the old ordering, stated so it cannot come back:
    expect(entry.url).not.toContain('undefined');
  });

  it('takes the port from the workspace, not from a hardcoded default', () => {
    const registry = new WorkspaceRegistry(dir);
    const ws = registry.selectOrCreate({ name: 'default' });
    // Deliberately a port the workspace would never land on by itself, so the
    // assertion cannot pass by coincidence. (`carryDefaults` is first-wins and
    // would have left `defaultPort` alone, making the check compare a value
    // against itself.)
    const moved = { ...ws, defaultPort: 4321 };
    expect(moved.defaultPort).not.toBe(ws.defaultPort);

    const project = bootstrapProject(registry, moved, cwd).project;
    expect(readEntry().url).toBe(`http://127.0.0.1:4321/api/projects/${project.id}/mcp`);
  });
});
