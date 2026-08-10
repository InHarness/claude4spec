import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createPatchToolsServer } from './patch-tools.js';

/**
 * `file_patch` over MCP — the channel the catalog declared `direct()` and nobody
 * had built.
 *
 * The tool is an adapter over `services/patch-write.ts`, which REST calls too,
 * so what is asserted here is what only the adapter can get wrong: that the
 * operation is reachable at all, that its answer is `{ path }` and not the patch
 * it was just handed, and that the shared validation reaches this channel rather
 * than only the REST one.
 */
describe('patch-tools', () => {
  let cwd: string;
  let client: Client;

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'c4s-patch-tools-'));
    await fs.mkdir(path.join(cwd, 'briefs'), { recursive: true });
    await fs.writeFile(path.join(cwd, 'briefs', 'b.md'), '# Brief\n', 'utf-8');
    const { server } = createPatchToolsServer({
      briefsDirAbs: path.join(cwd, 'briefs'),
      patchesDirAbs: path.join(cwd, 'patches'),
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'test-client', version: '0.0.0' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await fs.rm(cwd, { recursive: true, force: true });
  });

  async function call(name: string, args: Record<string, unknown>) {
    const res = await client.callTool({ name, arguments: args });
    const text = (res.content as Array<{ type: string; text?: string }>)[0]?.text ?? '{}';
    return { isError: res.isError === true, body: JSON.parse(text) as Record<string, any> };
  }

  it('renders file_patch, which the catalog claimed this channel already did', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['file_patch']);
  });

  it('answers with the path and nothing else — never the patch it was handed', async () => {
    const res = await call('file_patch', {
      brief: 'b.md',
      desc: 'echo in update_section',
      patchKind: 'drift',
      body: 'THE BODY THE CALLER ALREADY HAS',
    });
    expect(res.isError).toBe(false);
    expect(Object.keys(res.body)).toEqual(['path']);
    expect(JSON.stringify(res.body)).not.toContain('THE BODY THE CALLER ALREADY HAS');

    const written = await fs.readFile(path.join(cwd, 'patches', res.body.path), 'utf-8');
    expect(written).toContain('THE BODY THE CALLER ALREADY HAS');
    expect(written).toContain('# Patch — echo in update_section');
    // The channel is the identity of last resort, and it is the truthful one.
    expect(written).toContain('created_by: agent');
    expect(written).toContain('patch_kind: drift');
  });

  it('refuses a patch against a brief that is not there, rather than filing it into the void', async () => {
    const res = await call('file_patch', { brief: 'ghost.md', desc: 'd', body: 'b' });
    expect(res.isError).toBe(true);
    expect(res.body.code).toBe('BRIEF_NOT_FOUND');
  });

  it('applies the same validation REST does, because both call the same function', async () => {
    const res = await call('file_patch', { brief: 'b.md', desc: '   ', body: 'b' });
    expect(res.isError).toBe(true);
    expect(res.body.code).toBe('VALIDATION');
  });
});
