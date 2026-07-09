import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProgressService } from './progress.js';
import type { ReleaseService } from './release.js';
import type { BriefService } from './brief.js';
import type { GitService } from './git.js';
import type { Release } from '../../shared/entities.js';
import type { BriefListItem } from '../../shared/entities.js';
import type { GitAheadBehindStatus } from '../../shared/git.js';

function release(overrides: Partial<Release>): Release {
  return {
    id: 1,
    name: 'v1',
    description: 'desc',
    createdBy: 'user',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function brief(overrides: Partial<BriefListItem>): BriefListItem {
  return {
    path: 'briefs/x.md',
    title: null,
    source: 'release-diff',
    fromRelease: null,
    toRelease: null,
    implemented: false,
    generatedAt: '2026-01-01T00:00:00.000Z',
    lastModifiedAt: null,
    threadCount: 0,
    ...overrides,
  };
}

function fakeReleaseService(releases: Release[], throwOnList = false): ReleaseService {
  return {
    listReleases: () => {
      if (throwOnList) throw new Error('boom');
      return releases;
    },
  } as unknown as ReleaseService;
}

function fakeBriefService(briefs: BriefListItem[], throwOnList = false): BriefService {
  return {
    listBriefs: () => {
      if (throwOnList) throw new Error('boom');
      return briefs;
    },
  } as unknown as BriefService;
}

function fakeGitService(
  status: GitAheadBehindStatus | null | (() => Promise<GitAheadBehindStatus | null>),
): GitService {
  return {
    statusAheadBehind: async () => {
      if (typeof status === 'function') return status();
      return status;
    },
  } as unknown as GitService;
}

describe('ProgressService', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-progress-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('empty state: no releases, no briefs, no marker, no git', async () => {
    const svc = new ProgressService(fakeReleaseService([]), fakeBriefService([]), fakeGitService(null), dir);
    const progress = await svc.getProgress();
    expect(progress).toEqual({
      releases: [],
      unreleasedBriefs: [],
      implementedMarker: null,
      gitStatus: null,
    });
  });

  it('orders releases chronologically (oldest first) and buckets briefs by toRelease', async () => {
    const releases = [
      release({ id: 2, name: 'v2', createdAt: '2026-02-01T00:00:00.000Z' }),
      release({ id: 1, name: 'v1', createdAt: '2026-01-01T00:00:00.000Z' }),
    ]; // listReleases() is newest-first, per ReleaseService's real ordering
    const briefs = [
      brief({ path: 'briefs/a.md', toRelease: 'v1' }),
      brief({ path: 'briefs/b.md', toRelease: 'v2', implemented: true }),
      brief({ path: 'briefs/c.md', toRelease: null }),
    ];
    const svc = new ProgressService(fakeReleaseService(releases), fakeBriefService(briefs), fakeGitService(null), dir);
    const progress = await svc.getProgress();

    expect(progress.releases.map((r) => r.name)).toEqual(['v1', 'v2']);
    expect(progress.releases[0]!.briefs.map((b) => b.path)).toEqual(['briefs/a.md']);
    expect(progress.releases[1]!.briefs.map((b) => b.path)).toEqual(['briefs/b.md']);
    expect(progress.unreleasedBriefs.map((b) => b.path)).toEqual(['briefs/c.md']);
  });

  it('a brief with toRelease not matching any known release is silently dropped from every release bucket (not thrown, not surfaced elsewhere)', async () => {
    const releases = [release({ id: 1, name: 'v1' })];
    const briefs = [brief({ path: 'briefs/orphan.md', toRelease: 'v-does-not-exist' })];
    const svc = new ProgressService(fakeReleaseService(releases), fakeBriefService(briefs), fakeGitService(null), dir);
    const progress = await svc.getProgress();
    expect(progress.releases[0]!.briefs).toEqual([]);
    expect(progress.unreleasedBriefs).toEqual([]);
  });

  describe('implemented marker', () => {
    it('null when the marker file does not exist', async () => {
      const svc = new ProgressService(fakeReleaseService([]), fakeBriefService([]), fakeGitService(null), dir);
      expect((await svc.getProgress()).implementedMarker).toBeNull();
    });

    it('reads an exact-match release name from .c4s-implemented-release, trimmed', async () => {
      fs.writeFileSync(path.join(dir, '.c4s-implemented-release'), '  v1  \n');
      const svc = new ProgressService(fakeReleaseService([]), fakeBriefService([]), fakeGitService(null), dir);
      expect((await svc.getProgress()).implementedMarker).toBe('v1');
    });

    it('an empty marker file reads as null', async () => {
      fs.writeFileSync(path.join(dir, '.c4s-implemented-release'), '   \n');
      const svc = new ProgressService(fakeReleaseService([]), fakeBriefService([]), fakeGitService(null), dir);
      expect((await svc.getProgress()).implementedMarker).toBeNull();
    });

    it('a marker pointing at a nonexistent release is still returned as-is (client renders the mismatch warning, service does not validate)', async () => {
      fs.writeFileSync(path.join(dir, '.c4s-implemented-release'), 'v-does-not-exist\n');
      const releases = [release({ id: 1, name: 'v1' })];
      const svc = new ProgressService(fakeReleaseService(releases), fakeBriefService([]), fakeGitService(null), dir);
      expect((await svc.getProgress()).implementedMarker).toBe('v-does-not-exist');
    });
  });

  describe('per-source degradation — never throws, each source fails independently', () => {
    it('releases failing does not prevent briefs/marker/git from being returned', async () => {
      fs.writeFileSync(path.join(dir, '.c4s-implemented-release'), 'v1\n');
      const briefs = [brief({ path: 'briefs/a.md', toRelease: null })];
      const gitStatus: GitAheadBehindStatus = { branch: 'main', isDirty: false, ahead: 0, behind: 0 };
      const svc = new ProgressService(
        fakeReleaseService([], true),
        fakeBriefService(briefs),
        fakeGitService(gitStatus),
        dir,
      );
      const progress = await svc.getProgress();
      expect(progress.releases).toEqual([]);
      expect(progress.unreleasedBriefs.map((b) => b.path)).toEqual(['briefs/a.md']);
      expect(progress.implementedMarker).toBe('v1');
      expect(progress.gitStatus).toEqual(gitStatus);
    });

    it('briefs failing does not prevent releases/marker/git from being returned', async () => {
      const releases = [release({ id: 1, name: 'v1' })];
      const svc = new ProgressService(
        fakeReleaseService(releases),
        fakeBriefService([], true),
        fakeGitService(null),
        dir,
      );
      const progress = await svc.getProgress();
      expect(progress.releases).toEqual([{ id: 1, name: 'v1', createdAt: '2026-01-01T00:00:00.000Z', briefs: [] }]);
      expect(progress.unreleasedBriefs).toEqual([]);
    });

    it('git status throwing does not prevent releases/briefs/marker from being returned', async () => {
      const releases = [release({ id: 1, name: 'v1' })];
      const svc = new ProgressService(
        fakeReleaseService(releases),
        fakeBriefService([]),
        fakeGitService(() => Promise.reject(new Error('git not on PATH'))),
        dir,
      );
      const progress = await svc.getProgress();
      expect(progress.gitStatus).toBeNull();
      expect(progress.releases).toHaveLength(1);
    });
  });
});
