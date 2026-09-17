import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceRegistry } from './registry.js';
import { bootstrapProject } from './bootstrap.js';

/**
 * 0.2.93 — activation writes no integration artifact for external agents.
 *
 * `.claude4spec/mcp.json` is gone: the MCP config is rendered per request by
 * `GET /api/projects/:id/_meta/mcp-config`. This pins that the file does not
 * drift back into the bootstrap, and that a stale one from an older version is
 * left alone rather than rewritten.
 */
describe('bootstrapProject does not write mcp.json', () => {
  let dir: string;
  let cwd: string;
  const mcpJson = () => path.join(cwd, '.claude4spec', 'mcp.json');

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

  it('leaves no mcp.json behind', () => {
    const { result } = boot();
    // Bootstrap still does its own job.
    expect(result.project.id).toBeTruthy();
    expect(fs.existsSync(path.join(cwd, '.claude4spec'))).toBe(true);
    expect(fs.existsSync(mcpJson())).toBe(false);
  });

  it('does not touch an mcp.json left over from an older version', () => {
    fs.mkdirSync(path.join(cwd, '.claude4spec'), { recursive: true });
    const existing = '{"mcpServers":{"c4s-spec-reader":{"type":"http","url":"http://127.0.0.1:9999/x"}}}';
    fs.writeFileSync(mcpJson(), existing);
    boot();
    expect(fs.readFileSync(mcpJson(), 'utf8')).toBe(existing);
  });
});
