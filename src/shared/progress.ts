/**
 * M35 Progress — DTOs shared between server and client. Read-only, no table,
 * no MCP tool (progress is a human action, not an agent action). Aggregates
 * over M17 (releases), M21 (briefs as to-do units), and M28 (git status).
 */

import type { BriefListItem } from './entities.js';
import type { GitAheadBehindStatus } from './git.js';

export interface ProgressRelease {
  id: number;
  name: string;
  createdAt: string;
  /** Briefs whose `toRelease` matches this release's name. */
  briefs: BriefListItem[];
}

export interface ProgressResponse {
  /** Chronological, oldest → newest. */
  releases: ProgressRelease[];
  /** Briefs with `toRelease === null` — pending, no version boundary yet. */
  unreleasedBriefs: BriefListItem[];
  /**
   * Name of the most-recently-implemented release, per a code-side
   * convention (`<cwd>/.c4s-implemented-release`, exact match against a
   * release name) — a DECLARATION, not a git-derived fact, same posture as
   * `brief.implemented` (M21). `null` when the marker file is absent/empty,
   * or doesn't match any known release name (both render as "unknown
   * implementation state" client-side — never a thrown error).
   */
  implementedMarker: string | null;
  /** Passthrough of `gitService.statusAheadBehind()`; `null` when git is off or no repo. */
  gitStatus: GitAheadBehindStatus | null;
}
