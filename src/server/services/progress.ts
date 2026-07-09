/**
 * M35 Progress — read-only aggregator over M17 (releases), M21 (briefs),
 * and M28 (git status). No table, no MCP tool (progress is a human action,
 * not an agent action).
 *
 * Unlike every other route in this codebase, `getProgress()` degrades
 * per-source instead of failing the whole request — a missing/broken git
 * repo, an unparsable marker, or even a releases/briefs read failure each
 * degrade their own field rather than 500ing the page. This is a deliberate,
 * new pattern for this service (see brief 0-1-117-to-0-1-118 §M35): Progress
 * is read by humans checking status, not agents needing a hard contract.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { BriefListItem } from '../../shared/entities.js';
import type { ProgressRelease, ProgressResponse } from '../../shared/progress.js';
import type { ReleaseService } from './release.js';
import type { BriefService } from './brief.js';
import type { GitService } from './git.js';

const MARKER_FILE = '.c4s-implemented-release';

export class ProgressService {
  constructor(
    private releases: ReleaseService,
    private briefs: BriefService,
    private git: GitService,
    private cwd: string = process.cwd(),
  ) {}

  async getProgress(): Promise<ProgressResponse> {
    const releases = this.safeListReleases();
    const allBriefs = this.safeListBriefs();
    const gitStatus = await this.safeStatusAheadBehind();
    const implementedMarker = this.readMarker();

    const briefsByRelease = new Map<string, BriefListItem[]>();
    const unreleasedBriefs: BriefListItem[] = [];
    for (const brief of allBriefs) {
      if (brief.toRelease === null) {
        unreleasedBriefs.push(brief);
        continue;
      }
      const bucket = briefsByRelease.get(brief.toRelease);
      if (bucket) bucket.push(brief);
      else briefsByRelease.set(brief.toRelease, [brief]);
    }

    // listReleases() is newest-first — reverse to a chronological timeline
    // (oldest → newest) for the Progress view.
    const chronological = [...releases].reverse();
    const progressReleases: ProgressRelease[] = chronological.map((r) => ({
      id: r.id,
      name: r.name,
      createdAt: r.createdAt,
      briefs: briefsByRelease.get(r.name) ?? [],
    }));

    return {
      releases: progressReleases,
      unreleasedBriefs,
      implementedMarker,
      gitStatus,
    };
  }

  private safeListReleases(): ReturnType<ReleaseService['listReleases']> {
    try {
      return this.releases.listReleases();
    } catch (err) {
      console.error('[progress] listReleases failed:', err);
      return [];
    }
  }

  private safeListBriefs(): BriefListItem[] {
    try {
      return this.briefs.listBriefs();
    } catch (err) {
      console.error('[progress] listBriefs failed:', err);
      return [];
    }
  }

  private async safeStatusAheadBehind(): ReturnType<GitService['statusAheadBehind']> {
    try {
      return await this.git.statusAheadBehind();
    } catch (err) {
      console.error('[progress] statusAheadBehind failed:', err);
      return null;
    }
  }

  /**
   * Reads the code-side "implemented release" marker — a plain-text file at
   * `<cwd>/.c4s-implemented-release`, single line, exact string match against
   * a `Release.name`. This is a deliberately minimal convention (the spec
   * itself leaves format/location open — see brief §M35 "Otwarte"); a
   * clarification patch documents this choice for the spec-author. Never
   * throws — a missing file, an unreadable file, or an empty file all read
   * as `null` (client renders "unknown implementation state", not an error).
   */
  private readMarker(): string | null {
    try {
      const raw = fs.readFileSync(path.join(this.cwd, MARKER_FILE), 'utf-8').trim();
      return raw || null;
    } catch {
      return null;
    }
  }
}
