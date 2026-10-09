import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildSkillToolsServer, SKILL_TOOL_TEXT } from './skill-tools.js';
import { SkillRegistry, SkillResolver, type SkillRoot } from '../services/skill-registry.js';
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
    const root = path.join(tmp, 'styles');
    const dir = path.join(root, slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'SKILL.md'),
      `---\ntitle: ${slug}\ndescription: ${opts.description ?? `about ${slug}`}\nversion: 1\nlanguage: en\nscope: ${opts.scope ?? 'writing-style'}\n---\n# ${slug}\nthe body\n`,
    );
    return { dir: root, source: 'user' };
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

  it('exposes exactly one operation when built for a turn (no resolver)', async () => {
    await mount(SkillRegistry.load([]));
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['load_skill_file']);
    expect(tools[0]!.annotations).toMatchObject({ readOnlyHint: true, idempotentHint: true });
  });

  it('0.2.99: adds list_skills only when handed a resolver (the external surface)', () => {
    const registry = SkillRegistry.load([]);
    const turn = buildSkillToolsServer(registry);
    const external = buildSkillToolsServer(registry, 'p', { resolver: new SkillResolver(registry, tmp) });
    expect(turn.tools.map((t) => t.name)).toEqual(['load_skill_file']);
    expect(external.tools.map((t) => t.name)).toEqual(['load_skill_file', 'list_skills']);
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

    it('[ac:ac-wpis-pluginowy-niewidoczny-na-liscie] serves a plugin entry the calling context does not list (its contextTypes leave it out) — the listing narrows discovery, not access', async () => {
      // `resolveForContext` narrows what is WORTH opening; it does not narrow what
      // is reachable. A style is free to point at any skill the project has.
      // 0.2.66: a contextual skill is a package's contribution, and this one declares
      // `contextTypes: ['chat']` — so no `brief` turn lists it, and it opens there all
      // the same. The filter shapes the listing; it is not a gate on the reader.
      const registry = SkillRegistry.load([writeSkill('house-style')]);
      registry.addPluginSkill({
        slug: 'unattached',
        title: 'unattached',
        description: 'about unattached',
        version: 1,
        language: 'en',
        scope: 'contextual',
        contextTypes: ['chat'],
        content: '# unattached\nthe body',
      });
      await mount(registry);
      const resolver = new SkillResolver(registry, tmp);
      expect(resolver.resolveForContext('brief').listing).toEqual([]);
      expect(resolver.resolveForContext('chat').listing.map((s) => s.slug)).toEqual(['unattached']);
      const opened = await call({ slug: 'unattached' });
      expect(opened.isError).toBe(false);
      expect(opened.body).toMatchObject({ slug: 'unattached', source: 'plugin', scope: 'contextual' });
      expect(opened.body.content).toContain('the body');
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
    it('[ac:ac-slug-spoza-rejestru-m37-np-skill-z-cl] a slug outside the registry (reason "outside-registry") → SKILL_NOT_FOUND with the closest registry slugs', async () => {
      const root = writeSkill('house-style');
      writeSkill('house-rules');
      await mount(SkillRegistry.load([root]));

      // e.g. a harness skill the SDK discovers natively — no source of the registry delivers it.
      const { isError, body } = await call({ slug: 'house' });
      expect(isError).toBe(true);
      expect(body.code).toBe('SKILL_NOT_FOUND');
      expect(body.error).toContain('outside the registry');
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

    it.each(['constructor', 'toString', 'valueOf', 'hasOwnProperty'])(
      'SKILL_FILE_NOT_FOUND for "%s", an inherited Object.prototype member',
      async (file) => {
        // The package map is a plain object literal, so a lookup by truthiness
        // would resolve these to inherited functions and answer NOT_TEXT about a
        // path the manifest never listed.
        const root = writeSkill('house-style');
        fs.writeFileSync(path.join(root.dir, 'house-style', 'NOTES.md'), 'y');
        await mount(SkillRegistry.load([root]));

        const { isError, body } = await call({ slug: 'house-style', file });
        expect(isError).toBe(true);
        expect(body.code).toBe('SKILL_FILE_NOT_FOUND');
        expect(body.hint).toBe('available paths: NOTES.md');
      },
    );

    it.each([
      ['a ".." segment', 'workflows/../../etc/passwd'],
      ['an absolute POSIX path', '/etc/passwd'],
      ['a home-relative disk path', '/Users/me/.claude/skills/house-style/workflows/brief.md'],
      ['a Windows drive letter', 'C:\\skills\\x.md'],
      ['the package directory itself', '.'],
    ])('[ac:ac-file-zawierajacy-bedacy-sciezka-absol] INVALID_ARGUMENT for %s, with the canonical shape — nothing outside the package served', async (_label, file) => {
      // Refused BEFORE existence: the shape is wrong and will stay wrong, where
      // SKILL_FILE_NOT_FOUND would have said "this package merely lacks it".
      await mount(SkillRegistry.load([writeSkill('house-style')]));
      const { isError, body } = await call({ slug: 'house-style', file });
      expect(isError).toBe(true);
      expect(body.code).toBe('INVALID_ARGUMENT');
      expect(body.hint).toContain('workflows/brief.md');
      // A refusal, not a read: no content of any file comes back.
      expect(body.content).toBeUndefined();
      expect(JSON.stringify(body)).not.toContain('root:');
    });

    it('[ac:ac-file-wskazujacy-podplik-binarny-not-t] NOT_TEXT for a binary subfile the manifest already flagged isText: false', async () => {
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

  it('[ac:ac-podplik-przekraczajacy-default-budget] truncates a subfile past DEFAULT_BUDGET_CHARS with truncated + truncationHint, keeping the address (slug, file) unchanged', async () => {
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
    expect(body.slug).toBe('house-style');
  });

  it('[entity:skill-tools-load-skill-file] contract: name, input fields, description and both response shapes', async () => {
    const root = writeSkill('house-style');
    fs.mkdirSync(path.join(root.dir, 'house-style', 'workflows'), { recursive: true });
    fs.writeFileSync(path.join(root.dir, 'house-style', 'workflows', 'brief.md'), 'm\n');
    await mount(SkillRegistry.load([root]));

    const { tools } = await client.listTools();
    expect(tools).toHaveLength(1);
    const tool = tools[0]!;
    expect(tool.name).toBe('load_skill_file');
    expect(tool.description).toBe(SKILL_TOOL_TEXT.turn.loadSkillFile);
    expect(tool.description).toContain('<available_skills/>');
    expect(tool.description).toContain('<project_writing_skill>');
    const schema = tool.inputSchema as { properties: Record<string, { description?: string }>; required?: string[] };
    expect(Object.keys(schema.properties).sort()).toEqual(['file', 'slug']);
    expect(schema.required).toEqual(['slug']);
    expect(schema.properties.slug!.description).toBe(SKILL_TOOL_TEXT.turn.slug);
    expect(schema.properties.file!.description).toContain('Omit to open the skill itself.');

    // Opening: slug, title, description, scope, source, content, files — `hash` only from a writable source.
    const opened = await call({ slug: 'house-style' });
    expect(Object.keys(opened.body).sort()).toEqual(['content', 'description', 'files', 'scope', 'slug', 'source', 'title']);
    expect(opened.body.source).toBe('user');
    expect(opened.body.files).toEqual([{ path: 'workflows/brief.md', bytes: 2, lines: 1, isText: true }]);
    // Subfile: slug, path, content.
    const sub = await call({ slug: 'house-style', file: 'workflows/brief.md' });
    expect(Object.keys(sub.body).sort()).toEqual(['content', 'path', 'slug']);
  });

  it('[entity:c4s-reader-load-skill-file] contract on the external surface: name, input fields, wording that points at list_skills, response shape', async () => {
    const registry = SkillRegistry.load([writeSkill('house-style')]);
    const { tools } = buildSkillToolsServer(registry, 'p', { resolver: new SkillResolver(registry, tmp) });
    const tool = tools.find((t) => t.name === 'load_skill_file')!;
    expect(tool.description).toBe(SKILL_TOOL_TEXT.external.loadSkillFile);
    expect(tool.description).toContain('list_skills');
    expect(tool.description).toContain('invalidReason');

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const external = buildSkillToolsServer(registry, 'p', { resolver: new SkillResolver(registry, tmp) });
    client = new Client({ name: 'test-client', version: '0.0.0' });
    await external.server.connect(serverTransport);
    await client.connect(clientTransport);
    const listed = (await client.listTools()).tools.find((t) => t.name === 'load_skill_file')!;
    const schema = listed.inputSchema as { properties: Record<string, { description?: string }>; required?: string[] };
    expect(Object.keys(schema.properties).sort()).toEqual(['file', 'slug']);
    expect(schema.required).toEqual(['slug']);
    expect(schema.properties.slug!.description).toBe(SKILL_TOOL_TEXT.external.slug);

    const opened = await call({ slug: 'house-style' });
    expect(opened.isError).toBe(false);
    expect(opened.body).toMatchObject({ slug: 'house-style', scope: 'writing-style', source: 'user', files: [] });
    expect(typeof opened.body.content).toBe('string');
  });

  it('[entity:c4s-reader-list-skills] contract: name, optional contextType, rows { slug, description, origin } and writingStyle beside them', async () => {
    const registry = SkillRegistry.load([writeSkill('house-style')]);
    registry.addPluginSkill({
      slug: 'ui-view-mockup-generator',
      title: 'Mockups',
      description: 'Author the HTML mockup of a ui-view entity from its design system tokens.',
      version: 1,
      language: 'en',
      scope: 'contextual',
      content: 'body',
    });
    fs.mkdirSync(path.join(tmp, '.claude4spec'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.claude4spec', 'config.json'), JSON.stringify({ writingStyle: 'house-style' }));
    const external = buildSkillToolsServer(registry, 'p', { resolver: new SkillResolver(registry, tmp) });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'test-client', version: '0.0.0' });
    await external.server.connect(serverTransport);
    await client.connect(clientTransport);

    const tool = (await client.listTools()).tools.find((t) => t.name === 'list_skills')!;
    expect(tool.description).toBe(SKILL_TOOL_TEXT.external.listSkills);
    expect(tool.annotations).toMatchObject({ readOnlyHint: true, idempotentHint: true });
    const schema = tool.inputSchema as { properties: Record<string, { description?: string }>; required?: string[] };
    expect(Object.keys(schema.properties)).toEqual(['contextType']);
    expect(schema.required ?? []).toEqual([]);
    expect(schema.properties.contextType!.description).toContain(SKILL_TOOL_TEXT.external.contextType);

    const res = await client.callTool({ name: 'list_skills', arguments: {} });
    const body = JSON.parse((res.content as Array<{ text: string }>)[0]!.text);
    expect(body).toEqual({
      listing: [
        {
          slug: 'ui-view-mockup-generator',
          description: 'Author the HTML mockup of a ui-view entity from its design system tokens.',
          origin: 'plugin',
        },
      ],
      writingStyle: { slug: 'house-style', title: 'house-style' },
    });
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

  /**
   * 0.2.57 — a plugin-contributed package is served from the registry's MEMORY.
   *
   * That is the one real cost difference against the FS roots, which resolve a
   * package off the disk on every read: a contribution has no `path` to read from,
   * because its files are literals compiled into the plugin's module. The `fs` spy is
   * the assertion — a passing content check alone would look identical if the tool
   * had quietly found the files on disk.
   *
   * The TTL is deliberately LARGE here, where the rest of this file uses `0`. Since
   * 0.2.66 every FS root re-scans on demand (the cached-at-boot in-package root is
   * gone), so a zero window would have the disk root's own re-scan trip the spy and
   * say nothing about the plugin branch. The window makes the warm scan at `load()`
   * the last disk touch before the assertions.
   */
  it('[ac:ac-podpliki-pakietu-stylu-workflows-brie] serves a plugin package\'s subfiles (slug, file) without touching the disk', async () => {
    // A real disk root beside it, holding a DIFFERENT skill: the claim under test
    // is about the plugin branch of `resolve()`, not about a registry that happens
    // to have nowhere to look.
    const registry = SkillRegistry.load([writeSkill('house-style')], { rescanTtlMs: 60_000 });
    registry.addPluginStyle({
      slug: 'layered-vertical-slices',
      title: 'Layered Vertical Slices',
      description: 'contributed by an envelope, not found on disk',
      version: 1,
      language: 'en',
      content: '# Layered Specification Meta-Prompt\nthe conventions',
      files: {
        'workflows/brief.md': '# brief workflow\nhow a brief gets written here',
        'templates/module.md': '# module template\nthe shape of a module page',
      },
    });
    await mount(registry);
    // `addPluginSkill` invalidates the merged view, so the NEXT read re-scans the
    // disk root once. Spend that read here, before the spy, or it lands inside the
    // window and is mistaken for the plugin branch reaching for a file.
    registry.list();

    const readFileSync = vi.spyOn(fs, 'readFileSync');
    const readdirSync = vi.spyOn(fs, 'readdirSync');
    try {
      const manifest = await call({ slug: 'layered-vertical-slices' });
      expect(manifest.body.files.map((f: { path: string }) => f.path)).toEqual([
        'templates/module.md',
        'workflows/brief.md',
      ]);

      for (const [file, marker] of [
        ['workflows/brief.md', 'how a brief gets written here'],
        ['templates/module.md', 'the shape of a module page'],
      ] as const) {
        const { isError, body } = await call({ slug: 'layered-vertical-slices', file });
        expect(isError, file).toBe(false);
        expect(body.path).toBe(file);
        expect(body.content).toContain(marker);
      }

      expect(readFileSync).not.toHaveBeenCalled();
      expect(readdirSync).not.toHaveBeenCalled();
    } finally {
      readFileSync.mockRestore();
      readdirSync.mockRestore();
    }
  });
});
