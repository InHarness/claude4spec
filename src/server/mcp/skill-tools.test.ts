import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildSkillToolsServer, SKILL_TOOL_TEXT } from './skill-tools.js';
import { SkillRegistry, SkillResolver, type SkillRoot } from '../services/skill-registry.js';
import { DEFAULT_BUDGET_CHARS } from '../discovery/budget.js';
import { SKILL_TOOL_RECORDS } from '../../../tests/helpers/skill-tool-records.js';
import { expectToolMatchesToolRecord } from '../../../tests/helpers/write-tool-records.js';
import { expectOperationMatchesRecord } from '../../../tests/helpers/operation-records.js';

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

  async function mount(registry: SkillRegistry, opts: { external?: boolean } = {}) {
    const { server } = buildSkillToolsServer(
      registry,
      opts.external ? 'p' : null,
      opts.external ? { resolver: new SkillResolver(registry, tmp) } : {},
    );
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

    it('[ac:ac-podpliki-pakietu-skilla-spoza-templat] a workflows/*.md subfile is readable through load_skill_file(slug, file) alone — an MCP call, no FS built-in, no disk path in or out', async () => {
      const root = writeSkill('house-style');
      const dir = path.join(root.dir, 'house-style');
      fs.mkdirSync(path.join(dir, 'workflows'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'workflows', 'brief.md'), 'brief methodology');
      fs.writeFileSync(path.join(dir, 'workflows', 'patch.md'), 'patch methodology');
      await mount(SkillRegistry.load([root]));

      // The input carries an ADDRESS (slug, file) — the schema has no path-like field.
      const { tools } = await client.listTools();
      expect(Object.keys((tools[0]!.inputSchema.properties ?? {}) as Record<string, unknown>).sort()).toEqual([
        'file',
        'slug',
      ]);

      for (const [file, content] of [
        ['workflows/brief.md', 'brief methodology'],
        ['workflows/patch.md', 'patch methodology'],
      ] as const) {
        // The only thing the caller does is an MCP tool call — the client holds no Read/Glob/Grep.
        const { isError, body } = await call({ slug: 'house-style', file });
        expect(isError, file).toBe(false);
        expect(body).toEqual({ slug: 'house-style', path: file, content });
        // The answer names no disk location either.
        expect(JSON.stringify(body)).not.toContain(tmp);
      }
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

    it('[ac:ac-odmowa-skill-file-not-found-wylicza-w] SKILL_FILE_NOT_FOUND enumerates the package\'s available paths', async () => {
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

  /**
   * 2.1.26 — the `logic` both `load_skill_file` records state, observed through
   * the mounted tool: the handler calls the registry's live read and returns its
   * answer; each refusal keeps its code and hint; the winner of the whole
   * registry is served; content is cut at 50 000 characters.
   */
  async function expectLoadSkillFileLogic(): Promise<void> {
    // SKILL_NOT_FOUND: a slug the registry does not resolve, with the reason and the closest slugs.
    const unknown = await call({ slug: 'house' });
    expect(unknown.isError).toBe(true);
    expect(unknown.body.code).toBe('SKILL_NOT_FOUND');
    expect(unknown.body.error).toContain('outside the registry');
    expect(unknown.body.hint).toContain('house-style');
    // INVALID_ARGUMENT: empty, absolute, with a backslash, with a `..` segment, or the package directory.
    for (const file of ['', '/etc/passwd', 'workflows\\brief.md', 'workflows/../../x.md', '.']) {
      const bad = await call({ slug: 'house-style', file });
      expect(bad.isError, JSON.stringify(file)).toBe(true);
      expect(bad.body.code, JSON.stringify(file)).toBe('INVALID_ARGUMENT');
      expect(bad.body.hint, JSON.stringify(file)).toBeTruthy();
    }
    // SKILL_FILE_NOT_FOUND: a file outside the package.
    const missing = await call({ slug: 'house-style', file: 'workflows/patch.md' });
    expect(missing.body.code).toBe('SKILL_FILE_NOT_FOUND');
    // NOT_TEXT: a binary file.
    const binary = await call({ slug: 'house-style', file: 'diagram.png' });
    expect(binary.body.code).toBe('NOT_TEXT');
    // The budget is 50 000 characters.
    expect(DEFAULT_BUDGET_CHARS).toBe(50_000);
    const cut = await call({ slug: 'house-style', file: 'workflows/huge.md' });
    expect(cut.isError).toBe(false);
    expect(cut.body.content.length).toBe(50_000);
    expect(cut.body.truncated).toBe(true);
    expect(cut.body.truncationHint).toContain('workflows/huge.md');
    // No answer carries a disk path.
    const opened = await call({ slug: 'house-style' });
    expect(JSON.stringify(opened.body)).not.toContain(tmp);
  }

  /** A `house-style` package with a text subfile, a binary one and one past the budget. */
  function writeLogicPackage(): SkillRoot {
    const root = writeSkill('house-style');
    const dir = path.join(root.dir, 'house-style');
    fs.mkdirSync(path.join(dir, 'workflows'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'workflows', 'brief.md'), 'm\n');
    fs.writeFileSync(path.join(dir, 'workflows', 'huge.md'), 'x'.repeat(50_500));
    fs.writeFileSync(path.join(dir, 'diagram.png'), Buffer.from([0x89, 0x50, 0x00, 0x01]));
    return root;
  }

  it('[entity:skill-tools-load-skill-file] skill-tools · load_skill_file: name, description, slug (required) and file (optional, defaults to SKILL.md) as the record states them, readOnly + idempotent hints; opening answers slug/title/description/scope/source/content/files (hash only from a writable source), a file read answers slug/path/content; refusals SKILL_NOT_FOUND / INVALID_ARGUMENT / SKILL_FILE_NOT_FOUND / NOT_TEXT, content cut at 50 000 characters', async () => {
    const turn = buildSkillToolsServer(SkillRegistry.load([]));
    expectToolMatchesToolRecord(
      turn.tools.find((t) => t.name === 'load_skill_file'),
      SKILL_TOOL_RECORDS['skill-tools-load-skill-file']!,
    );
    expect(turn.tools.map((t) => t.name)).toEqual(['load_skill_file']);

    await mount(SkillRegistry.load([writeLogicPackage()]));
    const opened = await call({ slug: 'house-style' });
    expect(Object.keys(opened.body).sort()).toEqual(['content', 'description', 'files', 'scope', 'slug', 'source', 'title']);
    expect(opened.body.source).toBe('user');
    expect(opened.body.files).toContainEqual({ path: 'workflows/brief.md', bytes: 2, lines: 1, isText: true });
    const sub = await call({ slug: 'house-style', file: 'workflows/brief.md' });
    expect(Object.keys(sub.body).sort()).toEqual(['content', 'path', 'slug']);
    expect(sub.body).toEqual({ slug: 'house-style', path: 'workflows/brief.md', content: 'm\n' });
    await expectLoadSkillFileLogic();
  });

  it('[entity:c4s-reader-load-skill-file] c4s-reader · load_skill_file: name, description (points at list_skills), slug (required) and file (optional, defaults to SKILL.md) as the record states them, readOnly + idempotent hints; the same answers and refusals as the turn rendering, content cut at 50 000 characters', async () => {
    const registry = SkillRegistry.load([writeLogicPackage()]);
    const external = buildSkillToolsServer(registry, 'p', { resolver: new SkillResolver(registry, tmp) });
    expectToolMatchesToolRecord(
      external.tools.find((t) => t.name === 'load_skill_file'),
      SKILL_TOOL_RECORDS['c4s-reader-load-skill-file']!,
    );

    await mount(registry, { external: true });
    const opened = await call({ slug: 'house-style' });
    expect(opened.isError).toBe(false);
    expect(opened.body).toMatchObject({ slug: 'house-style', scope: 'writing-style', source: 'user' });
    expect(opened.body.hash).toBeUndefined();
    expect(typeof opened.body.content).toBe('string');
    const sub = await call({ slug: 'house-style', file: 'workflows/brief.md' });
    expect(sub.body).toEqual({ slug: 'house-style', path: 'workflows/brief.md', content: 'm\n' });
    await expectLoadSkillFileLogic();
  });

  it('[entity:c4s-reader-list-skills] c4s-reader · list_skills: name, description, optional contextType (a string, not an enum) as the record states them, readOnly + idempotent hints; answers { listing: [{ slug, description, origin }], writingStyle: { slug, title } }, the whole registry without contextType, INVALID_ARGUMENT naming the legal values for an unknown one', async () => {
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
    const declared = external.tools.find((t) => t.name === 'list_skills');
    expectToolMatchesToolRecord(declared, SKILL_TOOL_RECORDS['c4s-reader-list-skills']!);
    expect(external.tools.map((t) => t.name)).toEqual(['load_skill_file', 'list_skills']);

    await mount(registry, { external: true });
    const tool = (await client.listTools()).tools.find((t) => t.name === 'list_skills')!;
    const schema = tool.inputSchema as { properties: Record<string, { type?: string; enum?: unknown }>; required?: string[] };
    expect(schema.required ?? []).toEqual([]);
    // A plain string, deliberately not an enum: a value outside the list reaches the operation.
    expect(schema.properties.contextType!.type).toBe('string');
    expect(schema.properties.contextType!.enum).toBeUndefined();

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

    const refused = await client.callTool({ name: 'list_skills', arguments: { contextType: 'breif' } });
    expect(refused.isError).toBe(true);
    const refusal = JSON.parse((refused.content as Array<{ text: string }>)[0]!.text);
    expect(refusal.code).toBe('INVALID_ARGUMENT');
    for (const legal of ['chat', 'brief', 'patch', 'ask']) expect(refusal.error).toContain(legal);
  });

  /**
   * 2.1.26 — the two M37 catalog rows as their `spec-operation` records declare
   * them: `list_skills` (internal `n/a` with the record's reason, rendered by
   * `c4s-reader · list_skills`) and `load_skill_file` (four channels direct,
   * rendered by `skill-tools` internally and `c4s-reader` externally).
   */
  it('[entity:list-skills] list_skills: project, direct, internal n/a with the record\'s reason, cli/mcp/rest direct, no effects, idempotent, code INVALID_ARGUMENT, rendered by c4s-reader · list_skills, addressed by the context type — omitted it is the whole registry, an unknown one is INVALID_ARGUMENT with the legal values', async () => {
    const op = expectOperationMatchesRecord(
      {
        nazwa: 'list_skills',
        channels: {
          internal: {
            kind: 'na',
            reason:
              'tura dostaje listing jako blok `<available_skills>` promptu systemowego; montowanie MCP jest per serwer, więc narzędzie w tym kanale trafiłoby naraz do wszystkich czterech typów kontekstu',
          },
          cli: { kind: 'direct' },
          mcp: { kind: 'direct' },
          rest: { kind: 'direct' },
        },
        efekty: ['none'],
        idempotencja: true,
        opisTresci: undefined,
        kodyBledow: ['INVALID_ARGUMENT'],
        narzedzia: { mcp: ['c4s-reader-list-skills'] },
      },
      SKILL_TOOL_RECORDS,
    );
    expect(op.opClass).toBe('read');
    expect(Object.keys(op.inputSchema)).toEqual(['contextType']);

    // `zachowanie`, observed through the operation the renderings wrap.
    const { listSkills } = await import('../services/skill-operations.js');
    const registry = SkillRegistry.load([]);
    registry.addPluginSkill({
      slug: 'ui-view-mockup-generator',
      title: 'Mockups',
      description: 'Author the HTML mockup of a ui-view entity from its design system tokens.',
      version: 1,
      language: 'en',
      scope: 'contextual',
      content: 'body',
    });
    const resolver = new SkillResolver(registry, tmp);
    expect(listSkills(resolver).listing.map((r) => r.slug)).toEqual(['ui-view-mockup-generator']);
    let refusal: { code?: string; message?: string } | undefined;
    try {
      listSkills(resolver, 'breif');
    } catch (err) {
      refusal = err as { code?: string; message?: string };
    }
    expect(refusal?.code).toBe('INVALID_ARGUMENT');
    for (const legal of ['chat', 'brief', 'patch', 'ask']) expect(refusal?.message).toContain(legal);
  });

  it('[entity:load-skill-file] load_skill_file: project, direct, all four channels direct, no effects, idempotent, codes SKILL_NOT_FOUND, SKILL_FILE_NOT_FOUND, NOT_TEXT, INVALID_ARGUMENT, rendered by skill-tools · load_skill_file (internal) and c4s-reader · load_skill_file (mcp), addressed by (slug, file) with file defaulting to SKILL.md', async () => {
    const op = expectOperationMatchesRecord(
      {
        nazwa: 'load_skill_file',
        channels: { internal: { kind: 'direct' }, cli: { kind: 'direct' }, mcp: { kind: 'direct' }, rest: { kind: 'direct' } },
        efekty: ['none'],
        idempotencja: true,
        opisTresci: undefined,
        kodyBledow: ['SKILL_NOT_FOUND', 'SKILL_FILE_NOT_FOUND', 'NOT_TEXT', 'INVALID_ARGUMENT'],
        narzedzia: { internal: ['skill-tools-load-skill-file'], mcp: ['c4s-reader-load-skill-file'] },
      },
      SKILL_TOOL_RECORDS,
    );
    expect(op.opClass).toBe('read');
    expect(Object.keys(op.inputSchema).sort()).toEqual(['file', 'slug']);
    const shape = op.inputSchema as unknown as Record<string, { isOptional(): boolean }>;
    expect(shape.slug!.isOptional()).toBe(false);
    expect(shape.file!.isOptional()).toBe(true);
    // `file` defaults to SKILL.md: the explicit default reads the same as the omitted one.
    await mount(SkillRegistry.load([writeSkill('house-style')]));
    const omitted = await call({ slug: 'house-style' });
    const explicit = await call({ slug: 'house-style', file: 'SKILL.md' });
    expect(explicit.body.content).toBe(omitted.body.content);
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
