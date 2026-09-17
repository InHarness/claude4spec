import { describe, expect, it } from 'vitest';
import { GENERATED_MCP_PROFILE, mcpMountPath, renderMcpConfigVariants } from './mcp-config.js';

describe('renderMcpConfigVariants', () => {
  const variants = renderMcpConfigVariants({ port: 3123, projectId: 'proj-7' });
  const server = (i: number) =>
    (JSON.parse(variants[i]!.snippet) as { mcpServers: Record<string, Record<string, unknown>> }).mcpServers[
      'c4s-spec-reader'
    ]!;

  it('returns exactly three variants in presentation order', () => {
    expect(variants.map((v) => v.id)).toEqual(['http-project', 'http-workspace', 'stdio']);
    for (const v of variants) expect(v.label).toBeTruthy();
  });

  it('HTTP project-bound entry addresses the project mount with the read-only profile', () => {
    expect(GENERATED_MCP_PROFILE).toBe('ask');
    expect(server(0)).toEqual({ type: 'http', url: `http://127.0.0.1:3123${mcpMountPath('proj-7')}?profile=ask` });
  });

  it('HTTP workspace-bound entry names the project through ?project=', () => {
    expect(server(1)).toEqual({
      type: 'http',
      url: 'http://127.0.0.1:3123/api/workspace/mcp?project=proj-7&profile=ask',
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
      'http://127.0.0.1:3123/api/projects/proj-7/mcp?profile=ask',
    ]);
  });

  it('carries no absolute path and no workspace selector', () => {
    for (const v of variants) {
      expect(v.snippet).not.toMatch(/--project\b|--workspace\b|x-c4s-generated-by/);
    }
  });
});
