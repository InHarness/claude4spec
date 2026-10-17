import { describe, expect, it } from 'vitest';
import { GENERATED_MCP_PROFILE, MCP_CONFIG_SERVER_KEY, mcpMountPath, renderMcpConfigVariants } from './mcp-config.js';

describe('renderMcpConfigVariants', () => {
  const variants = renderMcpConfigVariants({ publicUrl: 'http://localhost:3123', projectId: 'proj-7' });
  const server = (i: number) =>
    (JSON.parse(variants[i]!.snippet) as { mcpServers: Record<string, Record<string, unknown>> }).mcpServers[
      'c4s-reader'
    ]!;

  it('returns exactly three variants in presentation order', () => {
    expect(variants.map((v) => v.id)).toEqual(['http-project', 'http-workspace', 'stdio']);
    for (const v of variants) expect(v.label).toBeTruthy();
  });

  it('HTTP project-bound entry addresses the project mount with the read-only profile', () => {
    expect(GENERATED_MCP_PROFILE).toBe('ask');
    expect(server(0)).toEqual({ type: 'http', url: `http://localhost:3123${mcpMountPath('proj-7')}?profile=ask` });
  });

  it('HTTP workspace-bound entry carries no project — each call names its own', () => {
    expect(server(1)).toEqual({
      type: 'http',
      url: 'http://localhost:3123/api/workspace/mcp?profile=ask',
    });
  });

  it('stdio entry launches the c4s-mcp bridge at the project mount, not a server', () => {
    const entry = server(2);
    expect(entry.command).toBe('npx');
    expect(entry.args).toEqual([
      '-y',
      '-p',
      '@inharness-ai/claude4spec',
      'c4s-mcp',
      '--url',
      'http://localhost:3123/api/projects/proj-7/mcp?profile=ask',
    ]);
  });

  it('carries no absolute path and no workspace selector', () => {
    for (const v of variants) {
      expect(v.snippet).not.toMatch(/--project\b|--workspace\b|x-c4s-generated-by/);
    }
  });

  it('joins publicUrl with the project id — e.g. https://c4s.firma.dev/api/projects/app-spec/mcp', () => {
    const [project, workspace, stdio] = renderMcpConfigVariants({
      publicUrl: 'https://c4s.firma.dev/',
      projectId: 'app-spec',
    }).map((v) => JSON.parse(v.snippet).mcpServers['c4s-reader']);
    expect(project.url).toBe('https://c4s.firma.dev/api/projects/app-spec/mcp?profile=ask');
    expect(workspace.url).toBe('https://c4s.firma.dev/api/workspace/mcp?profile=ask');
    expect(stdio.args.at(-1)).toBe('https://c4s.firma.dev/api/projects/app-spec/mcp?profile=ask');
  });

  // The spec's snippet: three entries, each a one-key `mcpServers` map keyed
  // `c4s-reader`; HTTP entries carry exactly `type` + `url`, the stdio entry
  // exactly `command` + `args`. Values (port, project id, `?profile=`) may differ.
  it('[entity:wpis-serwera-c4s-reader] every variant has the snippet structure — mcpServers.c4s-reader, http {type,url}, stdio {command,args}', () => {
    expect(MCP_CONFIG_SERVER_KEY).toBe('c4s-reader');
    for (const v of variants) {
      const parsed = JSON.parse(v.snippet) as Record<string, unknown>;
      expect(Object.keys(parsed)).toEqual(['mcpServers']);
      expect(Object.keys(parsed.mcpServers as object)).toEqual(['c4s-reader']);
    }
    // Wariant 1 — HTTP, project-bound mount.
    expect(Object.keys(server(0)).sort()).toEqual(['type', 'url']);
    expect(server(0).type).toBe('http');
    expect(server(0).url).toMatch(/^http:\/\/localhost:3123\/api\/projects\/proj-7\/mcp(\?|$)/);
    // Wariant 2 — HTTP, workspace-bound mount.
    expect(Object.keys(server(1)).sort()).toEqual(['type', 'url']);
    expect(server(1).type).toBe('http');
    expect(server(1).url).toMatch(/^http:\/\/localhost:3123\/api\/workspace\/mcp(\?|$)/);
    // Wariant 3 — stdio bridge.
    expect(Object.keys(server(2)).sort()).toEqual(['args', 'command']);
    expect(server(2).command).toBe('npx');
    const args = server(2).args as string[];
    expect(args.slice(0, 5)).toEqual(['-y', '-p', '@inharness-ai/claude4spec', 'c4s-mcp', '--url']);
    expect(args).toHaveLength(6);
    expect(args[5]).toMatch(/^http:\/\/localhost:3123\/api\/projects\/proj-7\/mcp(\?|$)/);
  });

  it('[section:wtv48f3x] the stdio variant launches bin c4s-mcp as `npx -y -p @inharness-ai/claude4spec c4s-mcp`, never `npx -y <package> …`', () => {
    const stdio = server(2);
    const args = stdio.args as string[];
    expect(`${stdio.command as string} ${args.slice(0, 4).join(' ')}`).toBe(
      'npx -y -p @inharness-ai/claude4spec c4s-mcp',
    );
    // The package is named through `-p`, so npx runs the named bin, not the
    // package's default `claude4spec` server entry.
    expect(args.indexOf('@inharness-ai/claude4spec')).toBe(args.indexOf('-p') + 1);
    for (const v of variants) {
      expect(v.snippet).not.toMatch(/"-y",\s*"@inharness-ai\/claude4spec"/);
    }
  });
});
