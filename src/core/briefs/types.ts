/**
 * 0.1.103 M11 — filesystem-only brief/patch reads for `c4s list-briefs` /
 * `read-brief` / `file-patch`. Deliberately independent of `BriefService`/
 * `PatchService` (server/services/brief.ts, patch.ts), which depend on a
 * heavy DI graph (PagesFrontmatterIndexer in-memory index, PageVersionService,
 * ChatService, ws emitter) the CLI's lightweight `resolveWorkspaceProject()`
 * never builds. These types/functions touch only `fs` + frontmatter — no
 * SQLite, no running server — so they work under `INDEX_NOT_MATERIALIZED`.
 */

export interface BriefFrontmatterRaw {
  type?: string;
  to_release?: string | null;
  implemented?: boolean;
  [key: string]: unknown;
}

export interface BriefListItem {
  /** Relative to briefsDir, e.g. "v0-3-to-v0-4.md". */
  path: string;
  frontmatter: BriefFrontmatterRaw;
  implemented: boolean;
}

export interface BriefListOpts {
  limit?: number;
  offset?: number;
  status?: 'implemented' | 'pending';
}

export interface BriefListResult {
  items: BriefListItem[];
  total: number;
}

export interface BriefReadResult {
  frontmatter: BriefFrontmatterRaw;
  body: string;
  content: string;
}

export type PatchKind = 'drift' | 'missing' | 'incorrect' | 'clarification';

export type BriefFsErrorCode = 'INVALID_ARGS' | 'BRIEF_NOT_FOUND' | 'PATCH_WRITE_FAILED';

export class BriefFsError extends Error {
  constructor(
    public code: BriefFsErrorCode,
    message: string,
    public hint?: string,
  ) {
    super(message);
    this.name = 'BriefFsError';
  }
}
