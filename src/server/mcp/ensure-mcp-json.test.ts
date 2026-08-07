import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ensureMcpJson,
  ensureMcpJsonForWorkspace,
  GENERATED_MCP_PROFILE,
  mcpJsonPath,
  mcpMountPath,
  renderMcpJson,
} from './ensure-mcp-json.js';

/**
 * 0.2.13 §3 — `.claude4spec/mcp.json` stops describing how to START a second
 * MCP process and starts describing where to REACH the one in the server.
 */
describe('mcp.json is an HTTP entry', () => {
  const rendered = () => JSON.parse(renderMcpJson({ projectAbsPath: '/spec/repo', port: 3123, projectId: 'proj-7' }));

  it('declares an http server pointing at the project mount point', () => {
    const entry = rendered().mcpServers['c4s-spec-reader'];
    expect(entry.type).toBe('http');
    expect(entry.url).toBe(`http://127.0.0.1:3123${mcpMountPath('proj-7')}?profile=ask`);
  });

  it('asks for a read-only profile, so the generated entry cannot write', () => {
    // The entry this replaced ran a process holding the db `readonly: true` and
    // could not write a byte. The mount's DEFAULT profile is `chat`, which
    // admits writes — so a URL with no profile would silently convert every
    // user's existing `c4s-spec-reader` into a full write surface on upgrade,
    // in a file claude4spec writes on their behalf. That the external surface
    // CAN now write is a decision this release made; that the generated config
    // should is a different one, and nobody made it.
    expect(GENERATED_MCP_PROFILE).toBe('ask');
    expect(rendered().mcpServers['c4s-spec-reader'].url).toContain('?profile=ask');
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

/**
 * 0.2.13 — refreshing EVERY project's config with the port actually bound.
 *
 * Two failures live here that the per-project writer could not express: an
 * upgrade must replace pre-0.2.13 stdio entries (the rewritten `c4s-mcp` exits 2
 * on their flags), and the URL must carry the port the server is listening on
 * rather than the workspace default.
 */
describe('ensureMcpJsonForWorkspace', () => {
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-mcpws-'));

  it('replaces a pre-0.2.13 stdio entry that the new bin cannot start', () => {
    const dir = tmp();
    try {
      // Exactly what 0.2.12 wrote. `parseArgs` in the rewritten bridge ignores
      // both flags, so left alone this file fails on every editor launch.
      fs.mkdirSync(path.join(dir, '.claude4spec'), { recursive: true });
      fs.writeFileSync(
        mcpJsonPath(dir),
        JSON.stringify({
          mcpServers: {
            'c4s-spec-reader': {
              command: 'npx',
              args: ['-y', '-p', '@inharness-ai/claude4spec', 'c4s-mcp', '--project', dir, '--workspace', 'default'],
            },
          },
        }),
      );

      ensureMcpJsonForWorkspace([{ id: 'p1', cwd: dir }], 4500);

      const entry = JSON.parse(fs.readFileSync(mcpJsonPath(dir), 'utf8')).mcpServers['c4s-spec-reader'];
      expect(entry.type).toBe('http');
      expect(entry.command).toBeUndefined();
      expect(entry.args).toBeUndefined();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes the port it is given, not a workspace default', () => {
    const dir = tmp();
    try {
      ensureMcpJsonForWorkspace([{ id: 'p1', cwd: dir }], 5000);
      expect(JSON.parse(fs.readFileSync(mcpJsonPath(dir), 'utf8')).mcpServers['c4s-spec-reader'].url).toContain(':5000');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('covers every project, not just one', () => {
    const a = tmp();
    const b = tmp();
    try {
      ensureMcpJsonForWorkspace([{ id: 'pa', cwd: a }, { id: 'pb', cwd: b }], 4500);
      expect(JSON.parse(fs.readFileSync(mcpJsonPath(a), 'utf8')).mcpServers['c4s-spec-reader'].url).toContain('/pa/');
      expect(JSON.parse(fs.readFileSync(mcpJsonPath(b), 'utf8')).mcpServers['c4s-spec-reader'].url).toContain('/pb/');
    } finally {
      fs.rmSync(a, { recursive: true, force: true });
      fs.rmSync(b, { recursive: true, force: true });
    }
  });

  it('a NON-canonical server does not re-point a healthy config at itself', () => {
    /**
     * `--port 5050`, a second instance, or `listenOrExit` retrying past a busy
     * port: none of those is the address an editor should be sent to. Writing
     * the bound port into every project's config leaves them all addressing a
     * dead port the moment that process exits, while the default-port server
     * keeps running and answering nothing.
     *
     * The file the user has is healthy; the transient server leaves it alone.
     */
    const dir = tmp();
    try {
      ensureMcpJsonForWorkspace([{ id: 'p1', cwd: dir }], 4500, 4500);
      ensureMcpJsonForWorkspace([{ id: 'p1', cwd: dir }], 5050, 4500);
      expect(JSON.parse(fs.readFileSync(mcpJsonPath(dir), 'utf8')).mcpServers['c4s-spec-reader'].url).toContain(':4500');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a non-canonical server still performs the upgrade repair, at the canonical address', () => {
    // A missing or stdio config is time-critical — the rewritten bridge exits 2
    // on every editor launch until it is replaced — so it is written even by a
    // transient server. What it writes is the address that will work once the
    // normal server is up, not the port this process happens to hold.
    const dir = tmp();
    try {
      ensureMcpJsonForWorkspace([{ id: 'p1', cwd: dir }], 5050, 4500);
      expect(JSON.parse(fs.readFileSync(mcpJsonPath(dir), 'utf8')).mcpServers['c4s-spec-reader'].url).toContain(':4500');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not steal a config that addresses a DIFFERENT project', () => {
    /**
     * One directory can be registered in two workspaces, and it has one
     * `mcp.json`. Last writer wins would mean an editor open on workspace A
     * silently starts talking to workspace B's copy — same repo, different
     * database, different entities, no error anywhere. A stale address the user
     * can see beats a live one pointing at the wrong specification.
     */
    const dir = tmp();
    try {
      ensureMcpJson({ projectAbsPath: dir, port: 4500, projectId: 'first-owner' });
      ensureMcpJson({ projectAbsPath: dir, port: 4600, projectId: 'other-workspace' });
      const url = JSON.parse(fs.readFileSync(mcpJsonPath(dir), 'utf8')).mcpServers['c4s-spec-reader'].url;
      expect(url).toContain('/first-owner/');
      expect(url).toContain(':4500');
      // The owner may still refresh its own entry.
      ensureMcpJson({ projectAbsPath: dir, port: 4700, projectId: 'first-owner' });
      expect(JSON.parse(fs.readFileSync(mcpJsonPath(dir), 'utf8')).mcpServers['c4s-spec-reader'].url).toContain(':4700');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a project directory that has gone away does not fail the start', () => {
    const ok = tmp();
    try {
      // The other projects still have to be served; one unwritable config is
      // not a reason to refuse to boot.
      expect(() =>
        ensureMcpJsonForWorkspace([{ id: 'gone', cwd: '/definitely/not/a/directory' }, { id: 'ok', cwd: ok }], 4500),
      ).not.toThrow();
      expect(fs.existsSync(mcpJsonPath(ok))).toBe(true);
    } finally {
      fs.rmSync(ok, { recursive: true, force: true });
    }
  });
});
