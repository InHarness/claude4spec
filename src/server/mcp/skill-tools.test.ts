import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildSkillToolsServer } from './skill-tools.js';
import { SkillRegistry, type SkillRoot } from '../services/skill-registry.js';
import { DEFAULT_BUDGET_CHARS } from '../discovery/budget.js';

/**
 * `load_skill_file` — the only channel to a skill's content since 0.2.36.
 *
 * What is asserted here is what only this adapter can get wrong: that opening a
 * skill hands back a MANIFEST alongside the body (so a subfile's cost is visible
 * before it is paid), that each of the four refusals carries the thing that
 * repairs it, and that a package path is validated as an ADDRESS rather than
 * resolved as a filesystem path.
 */
describe('skill-tools — load_skill_file', () => {
  let tmp: string;
  let client: Client;

  function writeSkill(slug: string, opts: { description?: string; scope?: string } = {}): SkillRoot {
    const root = path.join(tmp, 'bundled');
    const dir = path.join(root, slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'SKILL.md'),
      `---\ntitle: ${slug}\ndescription: ${opts.description ?? `about ${slug}`}\nversion: 1\nlanguage: en\nscope: ${opts.scope ?? 'writing-style'}\n---\n# ${slug}\nthe body\n`,
    );
    return { dir: root, source: 'bundled' };
  }

  async function mount(registry: SkillRegistry) {
    const { server } = buildSkillToolsServer(registry);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'test-client', version: '0.0.0' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  }

  async function call(args: Record<string, unknown>) {
    const res = await client.callTool({ name: 'load_skill_file', arguments: args });
    const text = (res.content as Array<{ type: string; text?: string }>)[0]?.text ?? '{}';
    return { isError: res.isError === true, body: JSON.parse(text) as Record<string, any> };
  }

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-skill-tools-'));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('exposes exactly one operation', async () => {
    await mount(SkillRegistry.load([]));
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['load_skill_file']);
  });

  describe('opening a skill (slug, no file)', () => {
    it('returns the body WITH a manifest of every other package file', async () => {
      const root = writeSkill('house-style');
      const dir = path.join(root.dir, 'house-style');
      fs.mkdirSync(path.join(dir, 'workflows'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'workflows', 'brief.md'), 'one\ntwo\n');
      await mount(SkillRegistry.load([root]));

      const { isError, body } = await call({ slug: 'house-style' });
      expect(isError).toBe(false);
      expect(body).toMatchObject({
        slug: 'house-style',
        title: 'house-style',
        description: 'about house-style',
        scope: 'writing-style',
      });
      expect(body.content).toContain('the body');
      // Frontmatter is `content`'s job to have stripped, not the reader's to skip.
      expect(body.content).not.toContain('version: 1');
      expect(body.files).toEqual([
        { path: 'workflows/brief.md', bytes: 8, lines: 2, isText: true },
      ]);
    });

    it('renders an empty manifest for a single-file skill, rather than omitting it', async () => {
      await mount(SkillRegistry.load([writeSkill('house-style')]));
      const { body } = await call({ slug: 'house-style' });
      expect(body.files).toEqual([]);
    });

    it('serves a skill the calling context never attached — the listing is not a permission boundary', async () => {
      // `resolveForContext` narrows what is WORTH opening; it does not narrow what
      // is reachable. A style is free to point at any skill the project has.
      const root = writeSkill('unattached', { scope: 'contextual' });
      await mount(SkillRegistry.load([root]));
      expect((await call({ slug: 'unattached' })).isError).toBe(false);
    });
  });

  describe('reading a subfile (slug + file)', () => {
    it('returns the named subfile by its package-relative address', async () => {
      const root = writeSkill('house-style');
      const dir = path.join(root.dir, 'house-style');
      fs.mkdirSync(path.join(dir, 'workflows'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'workflows', 'brief.md'), 'brief methodology');
      await mount(SkillRegistry.load([root]));

      const { isError, body } = await call({ slug: 'house-style', file: 'workflows/brief.md' });
      expect(isError).toBe(false);
      expect(body).toEqual({ slug: 'house-style', path: 'workflows/brief.md', content: 'brief methodology' });
    });

    it('never puts a disk path in the payload — the address is (slug, file)', async () => {
      const root = writeSkill('house-style');
      await mount(SkillRegistry.load([root]));
      const opened = await call({ slug: 'house-style' });
      expect(JSON.stringify(opened.body)).not.toContain(tmp);
    });

    it('defaults `file` to SKILL.md, the one path every caller can guess', async () => {
      await mount(SkillRegistry.load([writeSkill('house-style')]));
      const { isError, body } = await call({ slug: 'house-style', file: 'SKILL.md' });
      expect(isError).toBe(false);
      expect(body.path).toBe('SKILL.md');
      expect(body.content).toContain('the body');
    });

    it('accepts the noise a caller can legitimately produce ("./x", "a//b")', async () => {
      const root = writeSkill('house-style');
      const dir = path.join(root.dir, 'house-style');
      fs.mkdirSync(path.join(dir, 'workflows'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'workflows', 'brief.md'), 'x');
      await mount(SkillRegistry.load([root]));

      expect((await call({ slug: 'house-style', file: './workflows//brief.md' })).body.path).toBe(
        'workflows/brief.md',
      );
    });
  });

  describe('refusals', () => {
    it('SKILL_NOT_FOUND names the closest slugs in the registry', async () => {
      const root = writeSkill('house-style');
      writeSkill('house-rules');
      await mount(SkillRegistry.load([root]));

      const { isError, body } = await call({ slug: 'house' });
      expect(isError).toBe(true);
      expect(body.code).toBe('SKILL_NOT_FOUND');
      expect(body.hint).toContain('house-style');
      expect(body.hint).toContain('house-rules');
    });

    it('SKILL_FILE_NOT_FOUND enumerates the package\'s available paths', async () => {
      // Alongside the manifest, this refusal is the only channel through which the
      // layout of a package can be discovered.
      const root = writeSkill('house-style');
      const dir = path.join(root.dir, 'house-style');
      fs.mkdirSync(path.join(dir, 'workflows'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'workflows', 'brief.md'), 'x');
      fs.writeFileSync(path.join(dir, 'NOTES.md'), 'y');
      await mount(SkillRegistry.load([root]));

      const { isError, body } = await call({ slug: 'house-style', file: 'workflows/patch.md' });
      expect(isError).toBe(true);
      expect(body.code).toBe('SKILL_FILE_NOT_FOUND');
      expect(body.hint).toBe('available paths: NOTES.md, workflows/brief.md');
    });

    it.each([
      ['a ".." segment', 'workflows/../../etc/passwd'],
      ['an absolute POSIX path', '/etc/passwd'],
      ['a home-relative disk path', '/Users/me/.claude/skills/house-style/workflows/brief.md'],
      ['a Windows drive letter', 'C:\\skills\\x.md'],
      ['the package directory itself', '.'],
    ])('INVALID_ARGUMENT for %s, with the canonical shape', async (_label, file) => {
      // Refused BEFORE existence: the shape is wrong and will stay wrong, where
      // SKILL_FILE_NOT_FOUND would have said "this package merely lacks it".
      await mount(SkillRegistry.load([writeSkill('house-style')]));
      const { isError, body } = await call({ slug: 'house-style', file });
      expect(isError).toBe(true);
      expect(body.code).toBe('INVALID_ARGUMENT');
      expect(body.hint).toContain('workflows/brief.md');
    });

    it('NOT_TEXT for a binary subfile the manifest already flagged', async () => {
      const root = writeSkill('house-style');
      const dir = path.join(root.dir, 'house-style');
      fs.writeFileSync(path.join(dir, 'diagram.png'), Buffer.from([0x89, 0x50, 0x00, 0x01]));
      await mount(SkillRegistry.load([root]));

      // Predictable, not surprising: it was `isText: false` on the way in.
      const opened = await call({ slug: 'house-style' });
      expect(opened.body.files).toEqual([{ path: 'diagram.png', bytes: 4, lines: 0, isText: false }]);

      const { isError, body } = await call({ slug: 'house-style', file: 'diagram.png' });
      expect(isError).toBe(true);
      expect(body.code).toBe('NOT_TEXT');
    });
  });

  it('truncates past the budget, keeping the address unchanged', async () => {
    const root = writeSkill('house-style');
    const dir = path.join(root.dir, 'house-style');
    fs.mkdirSync(path.join(dir, 'workflows'), { recursive: true });
    const huge = 'x'.repeat(DEFAULT_BUDGET_CHARS + 500);
    fs.writeFileSync(path.join(dir, 'workflows', 'brief.md'), huge);
    await mount(SkillRegistry.load([root]));

    const { isError, body } = await call({ slug: 'house-style', file: 'workflows/brief.md' });
    expect(isError).toBe(false);
    expect(body.truncated).toBe(true);
    expect(body.content.length).toBe(DEFAULT_BUDGET_CHARS);
    expect(body.truncationHint).toContain('workflows/brief.md');
    expect(body.path).toBe('workflows/brief.md');
  });

  it('reads the LIVE registry, so a skill edited mid-thread takes effect on the next call', async () => {
    // The prompt's listing is frozen on a thread's first turn; this channel never is.
    const root = writeSkill('house-style');
    const registry = SkillRegistry.load([root], { rescanTtlMs: 0 });
    await mount(registry);
    expect((await call({ slug: 'house-style' })).body.content).toContain('the body');

    fs.writeFileSync(
      path.join(root.dir, 'house-style', 'SKILL.md'),
      `---\ntitle: house-style\ndescription: about house-style\nversion: 1\nlanguage: en\nscope: writing-style\n---\n# house-style\nrewritten\n`,
    );
    expect((await call({ slug: 'house-style' })).body.content).toContain('rewritten');
  });
});
