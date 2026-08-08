import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceRegistry } from './registry.js';
import { bootstrapProject } from './bootstrap.js';
import { mcpJsonPath } from '../mcp/ensure-mcp-json.js';

/**
 * 0.2.13 — `mcp.json` is deliberately NOT written by `bootstrapProject`.
 *
 * It briefly was, and both halves of that were wrong:
 *
 *   - the file names a URL, so it needs the port the server actually BOUND, and
 *     this function runs before `listen` (and `--port` overrides the workspace
 *     default, so `workspace.defaultPort` is a guess);
 *   - it must cover every project, and this function only runs for one being
 *     created or re-activated — so an existing project's pre-0.2.13 stdio entry
 *     would survive an upgrade that made it unstartable.
 *
 * `ensureMcpJsonForWorkspace`, called after `listen`, owns both. This file pins
 * the boundary so the write does not drift back here, where neither fact is
 * available.
 */
describe('bootstrapProject does not write mcp.json', () => {
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

  it('leaves no mcp.json behind — the port is not known yet', () => {
    const { result } = boot();
    // Bootstrap still does its own job.
    expect(result.project.id).toBeTruthy();
    expect(fs.existsSync(path.join(cwd, '.claude4spec'))).toBe(true);
    // …but writing a URL here could only have guessed the port.
    expect(fs.existsSync(mcpJsonPath(cwd))).toBe(false);
  });

  it('does not disturb a config that is already there', () => {
    // The upgrade path replaces a stale entry at startup, not here. If bootstrap
    // rewrote it with a guessed port it would undo that repair on re-activation.
    fs.mkdirSync(path.join(cwd, '.claude4spec'), { recursive: true });
    const existing = '{"mcpServers":{"c4s-spec-reader":{"type":"http","url":"http://127.0.0.1:9999/x"}}}';
    fs.writeFileSync(mcpJsonPath(cwd), existing);
    boot();
    expect(fs.readFileSync(mcpJsonPath(cwd), 'utf8')).toBe(existing);
  });
});
