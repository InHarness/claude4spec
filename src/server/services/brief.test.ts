import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import matter from 'gray-matter';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BriefService, composeBriefBody, type BriefServiceDeps } from './brief.js';
import { DomainError } from './tags.js';
import { toolFailure } from '../operations/envelope.js';
import { BRIEF_IMMUTABLE_FRONTMATTER_KEYS } from '../../shared/entities.js';
import { BRIEF_HEADER } from '../../shared/root-kinds.js';
import { M21_PROMPT_BLOCKS } from './system-prompt/blocks/m21-brief.js';
import { MarkdownFileStore } from './pages.js';
import { hashContent } from './artifact-content.js';
import type { SelfWriteMarker } from '../fs/sources.js';

/**
 * The self-write token and the write it covers, in `updateContent`.
 *
 * `suppress()` is issued BEFORE the write and is one-shot: whatever event arrives
 * next for that path consumes it. So a write that throws leaves a live token with
 * no event of its own, and the NEXT genuine edit — a user saving the brief in the
 * editor, inside the self-write window — is swallowed instead. `unsuppress` is
 * how a caller that knows its write failed hands the token back
 * (brief `0-2-23-to-next`).
 */
describe('BriefService.updateContent — the suppress token and a failed write', () => {
  let cwd: string;
  let calls: Array<{ op: 'suppress' | 'unsuppress'; relPath: string }>;

  const BODY = ['---', 'type: brief', 'implemented: false', '---', '# Brief', ''].join('\n');

  function makeService(overrides: Partial<BriefServiceDeps> = {}): BriefService {
    const briefsPages = new MarkdownFileStore({ cwd, dir: 'briefs', rootId: 'briefs', kind: 'briefs' });
    const writer: SelfWriteMarker = {
      markOrigin: () => {},
      flush: async () => {},
      suppress: (relPath) => calls.push({ op: 'suppress', relPath }),
      unsuppress: (relPath) => calls.push({ op: 'unsuppress', relPath }),
    };
    return new BriefService({
      briefsPages,
      briefsWatcher: writer,
      briefsSerializer: {} as BriefServiceDeps['briefsSerializer'],
      pageVersions: { recordVersion: async () => {} } as unknown as BriefServiceDeps['pageVersions'],
      chatService: {} as BriefServiceDeps['chatService'],
      releaseService: {} as BriefServiceDeps['releaseService'],
      frontmatterIndexer: { indexPage: async () => {} } as unknown as BriefServiceDeps['frontmatterIndexer'],
      ws: { broadcast: () => {} } as unknown as BriefServiceDeps['ws'],
      ...overrides,
    });
  }

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'c4s-brief-service-'));
    await fs.mkdir(path.join(cwd, 'briefs'), { recursive: true });
    await fs.writeFile(path.join(cwd, 'briefs', 'b.md'), BODY, 'utf-8');
    calls = [];
  });

  afterEach(async () => {
    // Before the rm: one test spies on `fs.writeFile`, and an unrestored spy would
    // leak its rejection into the next case.
    vi.restoreAllMocks();
    await fs.rm(cwd, { recursive: true, force: true });
  });

  it('keeps the token when the write succeeds — the echo is genuinely ours to eat', async () => {
    const service = makeService();

    await service.updateContent({ path: 'b.md', content: `${BODY}edited\n`, expectedHash: hashContent(BODY), changedBy: 'user' });

    expect(calls).toEqual([{ op: 'suppress', relPath: 'b.md' }]);
  });

  it('hands the token back when the write throws, so the next real edit is not swallowed', async () => {
    const service = makeService();
    // The write fails AFTER the token was issued — a full disk, a lost mount, a
    // permission flip. The reads before it must still succeed, so the failure is
    // injected at `writeFile` itself rather than staged on the filesystem.
    const writeFile = vi.spyOn(fs, 'writeFile').mockRejectedValueOnce(
      Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' }),
    );

    await expect(
      service.updateContent({ path: 'b.md', content: `${BODY}edited\n`, expectedHash: hashContent(BODY), changedBy: 'user' }),
    ).rejects.toThrow('ENOSPC');

    expect(writeFile).toHaveBeenCalledOnce();
    expect(calls).toEqual([
      { op: 'suppress', relPath: 'b.md' },
      { op: 'unsuppress', relPath: 'b.md' },
    ]);
  });

  it('keeps the token when a POST-write step throws — the bytes are on disk either way', async () => {
    const service = makeService({
      pageVersions: {
        recordVersion: async () => {
          throw new Error('version store unavailable');
        },
      } as unknown as BriefServiceDeps['pageVersions'],
    });

    await expect(
      service.updateContent({ path: 'b.md', content: `${BODY}edited\n`, expectedHash: hashContent(BODY), changedBy: 'user' }),
    ).rejects.toThrow('version store unavailable');

    // No `unsuppress`: the write DID happen, so its echo must still be suppressed.
    // Releasing here would resurrect exactly the event the token exists to eat.
    expect(calls).toEqual([{ op: 'suppress', relPath: 'b.md' }]);
    expect(await fs.readFile(path.join(cwd, 'briefs', 'b.md'), 'utf-8')).toContain('edited');
  });
});

/**
 * 0.2.64 — provenance is the SHAPE OF THE WINDOW. These cases pin the three
 * legal windows, the illegal fourth, and the two things that used to be decided
 * by the `source` label instead: the `roots` guard, and the posture guard that
 * refused a brief against the current state while
 * `agent.disableDirectFilesystemAccess` was on. That refusal is gone — such a
 * brief reads no repository, it gets the analysis in the parent's `message` —
 * and it is the TYPE that pins its removal: `BriefServiceDeps` no longer carries
 * `cwd`, so the service cannot reach a project config to consult. There is no
 * runtime case to write for it; one would pass whatever the flag said.
 */
describe('BriefService.createBrief — the window is the provenance', () => {
  let cwd: string;

  function makeService(
    releaseService: BriefServiceDeps['releaseService'] = {
      getLatestReleaseName: () => 'r1',
      getRelease: () => ({ name: 'r1' }),
    } as unknown as BriefServiceDeps['releaseService'],
  ): BriefService {
    return new BriefService({
      briefsPages: new MarkdownFileStore({ cwd, dir: 'briefs', rootId: 'briefs', kind: 'briefs' }),
      briefsWatcher: {
        markOrigin: () => {},
        flush: async () => {},
        suppress: () => {},
        unsuppress: () => {},
      } as SelfWriteMarker,
      briefsSerializer: {} as BriefServiceDeps['briefsSerializer'],
      pageVersions: { recordVersion: async () => {} } as unknown as BriefServiceDeps['pageVersions'],
      chatService: {} as BriefServiceDeps['chatService'],
      releaseService,
      frontmatterIndexer: { indexPage: async () => {} } as unknown as BriefServiceDeps['frontmatterIndexer'],
      ws: { broadcast: () => {} } as unknown as BriefServiceDeps['ws'],
    });
  }

  const readFrontmatter = async (briefPath: string): Promise<Record<string, unknown>> => {
    const raw = await fs.readFile(path.join(cwd, 'briefs', briefPath), 'utf-8');
    return matter(raw).data as Record<string, unknown>;
  };

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'c4s-brief-window-'));
  });
  afterEach(async () => {
    await fs.rm(cwd, { recursive: true, force: true });
  });

  it('opens the window to the current state when neither end is given, resolving `from` to latest', async () => {
    await expect(makeService().createBrief({})).resolves.toMatchObject({
      fromReleaseName: 'r1',
      toReleaseName: null,
    });
  });

  it('writes payload `content` verbatim as the body, and appends `suffix` to the slug', async () => {
    const { briefPath } = await makeService().createBrief({ content: '# Analysis\n\nbody text\n', suffix: 'tail' });
    expect(briefPath).toMatch(/tail/);
    const raw = await fs.readFile(path.join(cwd, 'briefs', briefPath), 'utf-8');
    expect(matter(raw).content.trim()).toBe('# Analysis\n\nbody text');
  });

  it('keeps a body that opens with `---` — frontmatter delimiters are body text', async () => {
    const svc = makeService();
    // The bodies an agent actually writes: a horizontal rule under a heading, and
    // a body that carries frontmatter of its own. Handed to gray-matter as a bare
    // string these are PARSED, not stored — the body is absorbed into the brief's
    // frontmatter and the file lands empty, on exit 0.
    for (const body of [
      '---\n\n# Drift\n\nreal content\n',
      '---\ntitle: Drift\n---\n\n# Body\n',
      // Invalid YAML in that leading block used to escape as a raw YAMLException
      // — not a DomainError — so the route answered 500 rather than storing it.
      '---\n\n## Section\n\n- a: [unclosed\n',
    ]) {
      const { briefPath } = await svc.createBrief({ content: body });
      const raw = await fs.readFile(path.join(cwd, 'briefs', briefPath), 'utf-8');
      expect(matter(raw).content).toBe(body);
      expect(matter(raw).data.type).toBe('brief');
    }
  });

  it('returns a hash of the bytes it wrote, which `getBrief` agrees with', async () => {
    const svc = makeService();
    const { briefPath, hash } = await svc.createBrief({ content: '# Ready-made\n\nwritten by the caller\n' });
    const raw = await fs.readFile(path.join(cwd, 'briefs', briefPath), 'utf-8');
    // The value is the one `update_brief` takes as `expectedHash`, so it has to
    // be the hash of the WHOLE file — frontmatter included — not of the body.
    expect(hash).toBe(hashContent(raw));
    await expect(svc.getBrief(briefPath)).resolves.toMatchObject({ hash });
  });

  it('refuses a blank `content` and leaves no file behind', async () => {
    const svc = makeService();
    for (const blank of ['', '   ', '\n\t ']) {
      await expect(svc.createBrief({ content: blank })).rejects.toMatchObject({ code: 'VALIDATION' });
    }
    // The refusal happens before `allocatePath`, so not even a half-written
    // artifact reaches the disk.
    await expect(fs.readdir(path.join(cwd, 'briefs'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('starts with only the heading when `content` is omitted', async () => {
    const { briefPath } = await makeService().createBrief({});
    const raw = await fs.readFile(path.join(cwd, 'briefs', briefPath), 'utf-8');
    expect(matter(raw).content.trim()).toBe('# Brief: r1 → (unreleased)');
  });

  it('treats an explicit null `from` with a set `to` as a window open at the start', async () => {
    await expect(
      makeService().createBrief({ fromReleaseName: null, toReleaseName: 'r2' }),
    ).resolves.toMatchObject({ fromReleaseName: null, toReleaseName: 'r2' });
  });

  it('[ac:ac-createbrief-wywolany-z-fromreleasename-n] rejects a window with neither end', async () => {
    await expect(
      makeService().createBrief({ fromReleaseName: null, toReleaseName: null }),
    ).rejects.toThrow(/at least one of fromReleaseName/);
  });

  it('[ac:ac-walidacja-proweniencji-createbrief-do] rejects a closed window whose ends are the same release', async () => {
    await expect(
      makeService().createBrief({ fromReleaseName: 'r1', toReleaseName: 'r1' }),
    ).rejects.toThrow(/from_release must differ/);
  });

  /**
   * 0.2.92 — BRIEF_SAME_RELEASE compares NAMES, as the identity they are
   * (`spec_release.name` is UNIQUE NOT NULL): case-sensitive like that UNIQUE,
   * after trim, and without resolving either end first.
   */
  describe('BRIEF_SAME_RELEASE compares names', () => {
    const lookups: string[] = [];
    const recordingReleases = (known: string[]) =>
      ({
        getLatestReleaseName: () => known[known.length - 1] ?? null,
        getRelease: (name: string) => {
          lookups.push(name);
          if (!known.includes(name)) throw Object.assign(new Error(`release '${name}' not found`), { code: 'NOT_FOUND' });
          return { name };
        },
      }) as unknown as BriefServiceDeps['releaseService'];

    beforeEach(() => {
      lookups.length = 0;
    });

    it('[ac:ac-createbrief-z-fromreleasename-i-torel] v0.3 / V0.3 differ only in case and pass the window validation', async () => {
      await expect(
        makeService(recordingReleases(['v0.3', 'V0.3'])).createBrief({ fromReleaseName: 'v0.3', toReleaseName: 'V0.3' }),
      ).resolves.toMatchObject({ fromReleaseName: 'v0.3', toReleaseName: 'V0.3' });
    });

    it('equal names after trim are the same release', async () => {
      await expect(
        makeService(recordingReleases(['r1'])).createBrief({ fromReleaseName: ' r1', toReleaseName: 'r1 ' }),
      ).rejects.toMatchObject({ code: 'BRIEF_SAME_RELEASE' });
    });

    it('refuses BEFORE any release lookup — a same-name window of a missing release is BRIEF_SAME_RELEASE, not NOT_FOUND', async () => {
      await expect(
        makeService(recordingReleases([])).createBrief({ fromReleaseName: 'ghost', toReleaseName: 'ghost' }),
      ).rejects.toMatchObject({ code: 'BRIEF_SAME_RELEASE' });
      expect(lookups).toEqual([]);
    });

    it('an explicit `to: null` skips the comparison — the open window is the current state, not a release', async () => {
      await expect(
        makeService(recordingReleases(['r1'])).createBrief({ fromReleaseName: 'r1', toReleaseName: null }),
      ).resolves.toMatchObject({ fromReleaseName: 'r1', toReleaseName: null });
    });
  });

  it('rejects `roots` while the `to` end is open — no second release to scope against', async () => {
    await expect(
      makeService().createBrief({ fromReleaseName: 'r1', roots: ['spec'] }),
    ).rejects.toThrow(/roots is not allowed/);
  });

  it('writes five frontmatter keys and neither `source` nor `generator_version`', async () => {
    const { briefPath } = await makeService().createBrief({
      fromReleaseName: 'r1',
      toReleaseName: 'r2',
    });
    const fm = await readFrontmatter(briefPath);
    expect(fm).toMatchObject({
      type: 'brief',
      from_release: 'r1',
      to_release: 'r2',
      implemented: false,
    });
    expect(fm.generated_at).toEqual(expect.any(String));
    expect(fm).not.toHaveProperty('source');
    expect(fm).not.toHaveProperty('generator_version');
  });

});

/**
 * Item 15 of brief 0-2-63-to-0-2-64: files written before this release carry
 * `source` and `generator_version`. The reader must ignore them, and the
 * immutability check must no longer guard them.
 */
describe('BriefService — legacy briefs carrying source / generator_version', () => {
  let cwd: string;

  const LEGACY = [
    '---',
    'type: brief',
    'source: analysis',
    'from_release: r1',
    'to_release: null',
    'generated_at: 2026-01-01T00:00:00.000Z',
    'generator_version: brief-author@0.1',
    'implemented: false',
    '---',
    '# Brief',
    '',
  ].join('\n');

  function makeService(): BriefService {
    return new BriefService({
      briefsPages: new MarkdownFileStore({ cwd, dir: 'briefs', rootId: 'briefs', kind: 'briefs' }),
      briefsWatcher: {
        markOrigin: () => {},
        flush: async () => {},
        suppress: () => {},
        unsuppress: () => {},
      } as SelfWriteMarker,
      briefsSerializer: {} as BriefServiceDeps['briefsSerializer'],
      pageVersions: { recordVersion: async () => {} } as unknown as BriefServiceDeps['pageVersions'],
      chatService: {} as BriefServiceDeps['chatService'],
      releaseService: {} as BriefServiceDeps['releaseService'],
      frontmatterIndexer: { indexPage: async () => {} } as unknown as BriefServiceDeps['frontmatterIndexer'],
      ws: { broadcast: () => {} } as unknown as BriefServiceDeps['ws'],
    });
  }

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'c4s-brief-legacy-'));
    await fs.mkdir(path.join(cwd, 'briefs'), { recursive: true });
    await fs.writeFile(path.join(cwd, 'briefs', 'legacy.md'), LEGACY, 'utf-8');
  });
  afterEach(async () => {
    await fs.rm(cwd, { recursive: true, force: true });
  });

  it('reads a legacy brief without tripping over the retired keys', async () => {
    const brief = await makeService().getBrief('legacy.md');
    expect(brief.frontmatter.from_release).toBe('r1');
    expect(brief.frontmatter.to_release).toBe(null);
  });

  it('lets an agent drop the retired keys — they are no longer immutable', async () => {
    const service = makeService();
    const current = await service.getBrief('legacy.md');
    const rewritten = [
      '---',
      'type: brief',
      'from_release: r1',
      'to_release: null',
      'generated_at: 2026-01-01T00:00:00.000Z',
      'implemented: false',
      '---',
      '# Brief',
      'edited',
      '',
    ].join('\n');

    await expect(
      service.updateContent({
        path: 'legacy.md',
        content: rewritten,
        expectedHash: current.hash,
        changedBy: 'agent',
      }),
    ).resolves.toBeTruthy();
  });

  it('[ac:ac-update-brief-odrzuca-probe-zmiany-kto] refuses content whose frontmatter changes any of the five immutable fields, with IMMUTABLE_FIELD, before writing', async () => {
    const service = makeService();
    const current = await service.getBrief('legacy.md');
    const changes: Array<[string, string]> = [
      ['type', current.content.replace('type: brief', 'type: plan')],
      ['from_release', current.content.replace('from_release: r1', 'from_release: r2')],
      ['to_release', current.content.replace('to_release: null', 'to_release: r9')],
      ['roots', current.content.replace('implemented: false', 'implemented: false\nroots:\n  - docs')],
      ['generated_at', current.content.replace('2026-01-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z')],
    ];
    expect(changes.map(([field]) => field).sort()).toEqual([...BRIEF_IMMUTABLE_FRONTMATTER_KEYS].sort());

    for (const [field, content] of changes) {
      expect(content, field).not.toBe(current.content);
      const err = await service
        .updateContent({ path: 'legacy.md', content, expectedHash: current.hash, changedBy: 'agent' })
        .then(() => null, (e: unknown) => e);
      expect(err, field).toBeInstanceOf(DomainError);
      expect((err as DomainError).code, field).toBe('IMMUTABLE_FIELD');
      expect((err as Error).message, field).toContain(field);
      // Validated BEFORE the write: the file on disk is untouched.
      expect(await fs.readFile(path.join(cwd, 'briefs', 'legacy.md'), 'utf-8'), field).toBe(LEGACY);
      // The agent channel renders it as the tool_result's code.
      const envelope = toolFailure(err);
      expect(envelope.isError, field).toBe(true);
      expect(JSON.parse(envelope.content[0]!.text).code, field).toBe('IMMUTABLE_FIELD');
    }
  });

  it('[ac:ac-update-brief-blokuje-zmiane-implement] refuses an `implemented` change smuggled in the content when the agent writes; PATCH frontmatter is the way to the field', async () => {
    const service = makeService();
    const current = await service.getBrief('legacy.md');
    const flipped = current.content.replace('implemented: false', 'implemented: true');

    const err = await service
      .updateContent({ path: 'legacy.md', content: flipped, expectedHash: current.hash, changedBy: 'agent' })
      .then(() => null, (e: unknown) => e);
    expect((err as DomainError).code).toBe('IMMUTABLE_FIELD');
    expect((err as Error).message).toContain('implemented');
    expect(await fs.readFile(path.join(cwd, 'briefs', 'legacy.md'), 'utf-8')).toBe(LEGACY);

    // The field's own route — the generic PATCH frontmatter (`updateFrontmatter`) — sets it.
    const after = await service.updateFrontmatter({ path: 'legacy.md', patch: { implemented: true }, changedBy: 'user' });
    expect(after.frontmatter.implemented).toBe(true);
    // And `implemented` is the one mutable field of the brief header contract.
    expect(BRIEF_HEADER.mutable).toEqual(['implemented']);
  });
});

/**
 * M21 `m21fmtct` — `roots` is immutable identity: written verbatim at creation,
 * omitted for the whole release, part of the slug, and protected on every agent
 * write exactly like the two ends of the window.
 */
describe('BriefService — the `roots` scope frontmatter', () => {
  let cwd: string;

  function makeService(): BriefService {
    return new BriefService({
      briefsPages: new MarkdownFileStore({ cwd, dir: 'briefs', rootId: 'briefs', kind: 'briefs' }),
      briefsWatcher: { markOrigin: () => {}, flush: async () => {}, suppress: () => {}, unsuppress: () => {} } as SelfWriteMarker,
      briefsSerializer: {} as BriefServiceDeps['briefsSerializer'],
      pageVersions: { recordVersion: async () => {} } as unknown as BriefServiceDeps['pageVersions'],
      chatService: {} as BriefServiceDeps['chatService'],
      releaseService: {
        getLatestReleaseName: () => 'v1',
        getRelease: () => ({ name: 'v1' }),
      } as unknown as BriefServiceDeps['releaseService'],
      frontmatterIndexer: { indexPage: async () => {} } as unknown as BriefServiceDeps['frontmatterIndexer'],
      ws: { broadcast: () => {} } as unknown as BriefServiceDeps['ws'],
    });
  }

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'c4s-brief-roots-'));
  });
  afterEach(async () => {
    await fs.rm(cwd, { recursive: true, force: true });
  });

  it('[ac:ac-frontmatter-roots-string-jest-immutab] `roots` is immutable on update_brief like the window ends; absent or `[]` means the whole release; the stored value is what release_diff gets', async () => {
    const service = makeService();

    // Absent and `[]` are the same scope: the whole release — no key, no slug segment.
    const whole = await service.createBrief({ fromReleaseName: 'v1', toReleaseName: 'v2' });
    const empty = await service.createBrief({ fromReleaseName: 'v1', toReleaseName: 'v2', roots: [] });
    expect(whole.briefPath).toBe('v1-to-v2.md');
    expect(empty.briefPath).toBe('v1-to-v2-2.md');
    for (const p of [whole.briefPath, empty.briefPath]) {
      const fm = (await service.getBrief(p)).frontmatter as Record<string, unknown>;
      expect(fm).not.toHaveProperty('roots');
    }

    // A scoped brief stores the array verbatim, and it is part of the slug.
    const scoped = await service.createBrief({ fromReleaseName: 'v1', toReleaseName: 'v2', roots: ['docs', 'skills'] });
    expect(scoped.briefPath).toBe('v1-to-v2-docs-skills.md');
    const brief = await service.getBrief(scoped.briefPath);
    expect(brief.frontmatter.roots).toEqual(['docs', 'skills']);

    // Immutable for the agent, like `from_release` / `to_release`.
    for (const content of [
      brief.content.replace('  - skills\n', ''),
      brief.content.replace(/roots:\n  - docs\n  - skills\n/, ''),
      brief.content.replace('from_release: v1', 'from_release: v0'),
    ]) {
      expect(content).not.toBe(brief.content);
      await expect(
        service.updateContent({ path: scoped.briefPath, content, expectedHash: brief.hash, changedBy: 'agent' }),
      ).rejects.toMatchObject({ code: 'IMMUTABLE_FIELD' });
    }
    expect((await service.getBrief(scoped.briefPath)).frontmatter.roots).toEqual(['docs', 'skills']);

    // Reproducible: the brief thread is told to pass exactly the stored array to
    // every release_diff call, so the page input does not depend on HEAD.
    const scopeBlock = M21_PROMPT_BLOCKS.find((b) => b.name === 'brief_scope')!;
    const rendered = scopeBlock.render({
      brief,
      roots: [{ id: 'docs', name: 'Docs', dir: 'docs', builtin: true }],
    } as unknown as Parameters<typeof scopeBlock.render>[0]);
    expect(rendered).toContain('pass `roots: ["docs","skills"]` to EVERY release_diff call');
    const wholeBlock = scopeBlock.render({
      brief: await service.getBrief(whole.briefPath),
      roots: [],
    } as unknown as Parameters<typeof scopeBlock.render>[0]);
    expect(wholeBlock).toBeNull();
  });
});

/**
 * `getBrief`'s response budget vs. the writer that composes from its answer.
 *
 * The window is right for a reader and wrong for a writer, and the two are the
 * same method — so the only thing standing between a punctual edit and a
 * silently amputated brief is which flag the write path passes.
 */
describe('BriefService.getBrief — `full` is the writer’s read', () => {
  let cwd: string;
  // Comfortably past DEFAULT_BUDGET_CHARS / 2, so the window really cuts.
  const BIG = ['---', 'type: brief', 'from_release: r1', 'to_release: r2', 'implemented: false', '---', '# Brief', '']
    .join('\n') + 'x'.repeat(200_000) + '\nTAIL MARKER\n';

  function makeService(): BriefService {
    return new BriefService({
      briefsPages: new MarkdownFileStore({ cwd, dir: 'briefs', rootId: 'briefs', kind: 'briefs' }),
      briefsWatcher: {
        markOrigin: () => {},
        flush: async () => {},
        suppress: () => {},
        unsuppress: () => {},
      } as SelfWriteMarker,
      briefsSerializer: {} as BriefServiceDeps['briefsSerializer'],
      pageVersions: { recordVersion: async () => {} } as unknown as BriefServiceDeps['pageVersions'],
      chatService: {} as BriefServiceDeps['chatService'],
      releaseService: {} as BriefServiceDeps['releaseService'],
      frontmatterIndexer: { indexPage: async () => {} } as unknown as BriefServiceDeps['frontmatterIndexer'],
      ws: { broadcast: () => {} } as unknown as BriefServiceDeps['ws'],
    });
  }

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'c4s-brief-full-'));
    await fs.mkdir(path.join(cwd, 'briefs'), { recursive: true });
    await fs.writeFile(path.join(cwd, 'briefs', 'big.md'), BIG, 'utf-8');
  });
  afterEach(async () => {
    await fs.rm(cwd, { recursive: true, force: true });
  });

  it('cuts a long brief for a plain read, and says so', async () => {
    const brief = await makeService().getBrief('big.md');
    expect(brief.truncated).toBe(true);
    expect(brief.content).not.toContain('TAIL MARKER');
    // The hash is still the WHOLE file's — which is exactly what made composing
    // from this body pass the `expectedHash` guard.
    expect(brief.hash).toHaveLength(64);
  });

  it('returns the whole body under `full`, so an edit cannot amputate the tail', async () => {
    const brief = await makeService().getBrief('big.md', { full: true });
    expect(brief.truncated).toBeUndefined();
    expect(brief.body).toContain('TAIL MARKER');
    expect(brief.content).toBe(BIG);
  });

  it('a differential write through the service keeps the text past the window', async () => {
    const service = makeService();
    const current = await service.getBrief('big.md', { full: true });
    await service.updateContent({
      path: 'big.md',
      content: current.content.replace('# Brief', '# Brief edited'),
      expectedHash: current.hash,
      changedBy: 'agent',
    });
    const after = await fs.readFile(path.join(cwd, 'briefs', 'big.md'), 'utf-8');
    expect(after).toContain('# Brief edited');
    expect(after).toContain('TAIL MARKER');
    expect(after.length).toBeGreaterThan(200_000);
  });
});

describe('composeBriefBody — insert_after_section on the shared section parser (2.0.0)', () => {
  const body = ['# Brief', '', '## Goals', 'g', '', '### Detail', 'd', '', '## Risks', 'r', ''].join('\n');

  it('lands after the target subtree, found by heading text', () => {
    const out = composeBriefBody(body, 'insert_after_section', 'NEW', undefined, 'Goals');
    expect(out.warning).toBeUndefined();
    expect(out.body.indexOf('NEW')).toBeGreaterThan(out.body.indexOf('d'));
    expect(out.body.indexOf('NEW')).toBeLessThan(out.body.indexOf('## Risks'));
  });

  it('a heading inside a code block is never a target — miss appends at the end, with a warning', () => {
    const fenced = ['## Real', 'x', '```md', '## Example', '```', ''].join('\n');
    const out = composeBriefBody(fenced, 'insert_after_section', 'NEW', undefined, 'Example');
    expect(out.body.trimEnd().endsWith('NEW')).toBe(true);
    expect(out.warning).toMatch(/matches no section/);
  });

  it('an unknown anchor appends at the end, with a warning', () => {
    const out = composeBriefBody(body, 'insert_after_section', 'NEW', 'zzzzzzzz');
    expect(out.body.trimEnd().endsWith('NEW')).toBe(true);
    expect(out.warning).toMatch(/anchor 'zzzzzzzz'/);
  });

  it('an ambiguous heading lands after the FIRST match, with an ambiguity warning', () => {
    const twice = ['## Notes', 'a', '', '## Notes', 'b', ''].join('\n');
    const out = composeBriefBody(twice, 'insert_after_section', 'NEW', undefined, 'Notes');
    expect(out.body.indexOf('NEW')).toBeLessThan(out.body.indexOf('b'));
    expect(out.warning).toMatch(/matches 2 sections/);
  });

  it('blank-line runs away from the insertion point are left untouched', () => {
    const spaced = ['## A', '```', 'x', '', '', '', 'y', '```', '', '## B', 'b', ''].join('\n');
    const out = composeBriefBody(spaced, 'insert_after_section', 'NEW', undefined, 'B');
    expect(out.body).toContain('x\n\n\n\ny');
  });

  it('a duplicated anchor warns by anchor, not by heading', () => {
    const dup = ['<!-- anchor: abcdefgh -->', '## A', 'a', '', '<!-- anchor: abcdefgh -->', '## B', 'b', ''].join('\n');
    const out = composeBriefBody(dup, 'insert_after_section', 'NEW', 'abcdefgh');
    expect(out.warning).toMatch(/anchor 'abcdefgh'/);
    expect(out.warning).not.toMatch(/undefined/);
  });

  it('an anchor left by the author addresses its heading', () => {
    const anchored = ['<!-- anchor: abcdefgh -->', '## A', 'a', '', '## B', 'b', ''].join('\n');
    const out = composeBriefBody(anchored, 'insert_after_section', 'NEW', 'abcdefgh');
    expect(out.warning).toBeUndefined();
    expect(out.body.indexOf('NEW')).toBeLessThan(out.body.indexOf('## B'));
  });
});
