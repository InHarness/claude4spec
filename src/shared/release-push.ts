/**
 * M25 Release Push — DTOs exposed by `/api/release-pushes/*` to the c4s client.
 * These are M25's OWN surface, decoupled from the remote-API wire format
 * (claude4spec-api). The backend (`release-push.ts`) maps a `release_push` row
 * onto these camelCase shapes and joins `spec_release` for the nested release
 * meta (so the UI does not need a second fetch).
 */

/** Body of `POST /api/release-pushes`. */
export interface ReleasePushRequest {
  /** FK to `spec_release.id` — the local release to push. */
  releaseId: number;
}

/**
 * Response of `POST /api/release-pushes` (success or dedup hit) and
 * `GET /api/release-pushes/:id`. A full `release_push` row in camelCase plus a
 * nested snapshot of the local release meta. GET endpoints return rows of both
 * statuses; POST never returns a `status='error'` row (errors → 502 with a
 * different envelope).
 */
export interface ReleasePushResponse {
  id: number;
  releaseId: number;
  release: { id: number; name: string };
  /** UUID; undefined for first-push error rows (peer never returned an id). */
  remoteProjectId?: string;
  /** NULL/undefined for status='error'. */
  remoteReleaseId?: string;
  /** NULL/undefined for status='error'. */
  remoteReleaseSequence?: number;
  /** lowercase hex64 — /^[0-9a-f]{64}$/. */
  contentSha256: string;
  contentSizeBytes: number;
  deduplicated: boolean;
  pushedByAccountId: string;
  /** Cached identity — may be stale. */
  pushedByAccountEmail?: string;
  bundleSchemaVersion: number;
  status: 'success' | 'error';
  /** Only for status='error'. */
  errorMessage?: string;
  /** ISO 8601. */
  pushedAt: string;
}

/** Response of `GET /api/release-pushes`. */
export interface ReleasePushListResponse {
  items: ReleasePushResponse[];
}
