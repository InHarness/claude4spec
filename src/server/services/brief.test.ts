import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import matter from 'gray-matter';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BriefService, type BriefServiceDeps } from './brief.js';
import { PagesService } from './pages.js';
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
    const briefsPages = new PagesService(cwd, 'briefs', 'briefs');
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

    await service.updateContent({ path: 'b.md', content: `${BODY}edited\n`, changedBy: 'user' });

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
      service.updateContent({ path: 'b.md', content: `${BODY}edited\n`, changedBy: 'user' }),
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
      service.updateContent({ path: 'b.md', content: `${BODY}edited\n`, changedBy: 'user' }),
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
 * brief reads no repository, it gets the analysis in the parent's `message`.
 */
describe('BriefService.createBrief — the window is the provenance', () => {
  let cwd: string;

  const writeConfig = async (agent: Record<string, unknown>) => {
    await fs.mkdir(path.join(cwd, '.claude4spec'), { recursive: true });
    await fs.writeFile(
      path.join(cwd, '.claude4spec', 'config.json'),
      JSON.stringify({ $schemaVersion: 4, name: 'test', agent }),
    );
  };

  function makeService(): BriefService {
    return new BriefService({
      briefsPages: new PagesService(cwd, 'briefs', 'briefs'),
      briefsWatcher: {
        markOrigin: () => {},
        flush: async () => {},
        suppress: () => {},
        unsuppress: () => {},
      } as SelfWriteMarker,
      briefsSerializer: {} as BriefServiceDeps['briefsSerializer'],
      pageVersions: { recordVersion: async () => {} } as unknown as BriefServiceDeps['pageVersions'],
      chatService: {} as BriefServiceDeps['chatService'],
      releaseService: {
        getLatestReleaseName: () => 'r1',
        getRelease: () => ({ name: 'r1' }),
      } as unknown as BriefServiceDeps['releaseService'],
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

  it('creates a brief against the current state even with direct FS access blocked', async () => {
    await writeConfig({ disableDirectFilesystemAccess: true });

    await expect(makeService().createBrief({ fromReleaseName: 'r1' })).resolves.toMatchObject({
      toReleaseName: null,
    });
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
      briefsPages: new PagesService(cwd, 'briefs', 'briefs'),
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

  it('[ac:ac-update-brief-odrzuca-probe-zmiany-kto] still refuses a change to an end of the window', async () => {
    const service = makeService();
    const current = await service.getBrief('legacy.md');

    await expect(
      service.updateContent({
        path: 'legacy.md',
        content: current.content.replace('from_release: r1', 'from_release: r2'),
        expectedHash: current.hash,
        changedBy: 'agent',
      }),
    ).rejects.toThrow(/from_release/);
  });
});
