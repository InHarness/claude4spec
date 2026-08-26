import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
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

  // `source` is spelled out because `getBrief` defaults it on READ but the
  // immutability check compares against the incoming content verbatim.
  const BODY = ['---', 'type: brief', 'source: release-diff', 'implemented: false', '---', '# Brief', ''].join('\n');

  function makeService(overrides: Partial<BriefServiceDeps> = {}): BriefService {
    const briefsPages = new PagesService(cwd, 'briefs', 'briefs');
    const writer: SelfWriteMarker = {
      markOrigin: () => {},
      flush: async () => {},
      suppress: (relPath) => calls.push({ op: 'suppress', relPath }),
      unsuppress: (relPath) => calls.push({ op: 'unsuppress', relPath }),
    };
    return new BriefService({
      cwd,
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
 * 0.2.53 — an analysis brief is written by reading SOMEBODY ELSE'S repository
 * with the built-in file tools, and no core operation replaces them. So the
 * default posture refuses it at CREATION rather than opening a thread whose
 * agent has nothing to work with.
 *
 * Enforced in the service, not the route, so the in-process caller
 * (`TransagentDispatcher`) cannot bypass it — the same reason the neighbouring
 * `roots` guard lives here.
 */
describe('BriefService.create — source: analysis vs the built-in tool posture', () => {
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
      cwd,
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

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'c4s-brief-analysis-'));
  });
  afterEach(async () => {
    await fs.rm(cwd, { recursive: true, force: true });
  });

  it('[ac:ac-istniejacy-projekt-bez-pola-dostaje] refuses an analysis brief under the default posture, naming the setting', async () => {
    await writeConfig({});

    await expect(
      makeService().createBrief({ source: 'analysis', fromReleaseName: 'r1', toReleaseName: null }),
    ).rejects.toThrow(/Block direct file access/);
  });

  it('allows an analysis brief once direct FS access is enabled', async () => {
    await writeConfig({ disableDirectFilesystemAccess: false });

    await expect(
      makeService().createBrief({ source: 'analysis', fromReleaseName: 'r1', toReleaseName: null }),
    ).resolves.toMatchObject({ toReleaseName: null });
  });
});
