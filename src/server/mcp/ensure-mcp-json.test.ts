import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureMcpJson, mcpJsonPath, mcpMountPath, renderMcpJson } from './ensure-mcp-json.js';

/**
 * 0.2.13 §3 — `.claude4spec/mcp.json` stops describing how to START a second
 * MCP process and starts describing where to REACH the one in the server.
 */
describe('mcp.json is an HTTP entry', () => {
  const rendered = () => JSON.parse(renderMcpJson({ projectAbsPath: '/spec/repo', port: 3123, projectId: 'proj-7' }));

  it('declares an http server pointing at the project mount point', () => {
    const entry = rendered().mcpServers['c4s-spec-reader'];
    expect(entry.type).toBe('http');
    expect(entry.url).toBe(`http://127.0.0.1:3123${mcpMountPath('proj-7')}`);
    expect(entry.url).toBe('http://127.0.0.1:3123/api/projects/proj-7/mcp');
  });

  it('names no stdio command — the bridge is no longer what a client launches', () => {
    const entry = rendered().mcpServers['c4s-spec-reader'];
    expect(entry.command).toBeUndefined();
    expect(entry.args).toBeUndefined();
  });

  it('carries neither an absolute path nor a workspace selector', () => {
    // Both used to be baked in, which is why moving the spec repo invalidated
    // the file and why the reader needed to resolve a workspace at all. The
    // project is addressed by id now, and workspace resolution belongs to M31
    // inside the server process.
    const text = renderMcpJson({ projectAbsPath: '/spec/repo', port: 3123, projectId: 'proj-7' });
    expect(text).not.toContain('/spec/repo');
    expect(text).not.toContain('--workspace');
    expect(text).not.toContain('--project');
  });

  it('rewrites only when the URL actually moves', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-mcpjson-'));
    try {
      ensureMcpJson({ projectAbsPath: dir, port: 3000, projectId: 'p1' });
      const first = fs.statSync(mcpJsonPath(dir)).mtimeMs;

      // Same inputs: `writeIfChanged` must leave the file alone, so re-activating
      // an unchanged project does not churn a gitignored-but-watched file.
      ensureMcpJson({ projectAbsPath: dir, port: 3000, projectId: 'p1' });
      expect(fs.statSync(mcpJsonPath(dir)).mtimeMs).toBe(first);

      ensureMcpJson({ projectAbsPath: dir, port: 3001, projectId: 'p1' });
      expect(JSON.parse(fs.readFileSync(mcpJsonPath(dir), 'utf8')).mcpServers['c4s-spec-reader'].url).toContain(':3001');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
