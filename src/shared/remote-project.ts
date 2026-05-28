/**
 * M25/M26 — shape of `GET /api/remote-project` and `PATCH /api/remote-project`.
 * Local proxy DTOs that join `config.remoteProjectId` (M01) with the M24 remote-
 * account session status and an optional snapshot of the upstream project.
 *
 * Three scenarios A/B/C plus the 404 edge case C' (brief 0.1.32 §2c):
 *   A  linked:false                      — empty state.
 *   B  linked:true, fetched:true, isOwner:true   — full data + edit form.
 *   C  linked:true, fetched:true, isOwner:false  — read-only public subset.
 *   C' linked:true, fetched:false, reason:'not_found' — banner.
 *
 * `reason: 'not_connected'` was removed in 0.1.32 — anonymous users now fetch
 * the public subset; `isOwner` is the sole switch between B and C.
 */
export interface RemoteProjectInfo {
  /** True iff `config.remoteProjectId` is non-null. */
  linked: boolean;
  /** UUID from `config.remoteProjectId`. `null` when `linked: false`. */
  projectId: string | null;
  /** True iff the backend actually fetched remote project data. */
  fetched: boolean;
  /** True iff the current account is the owner of the remote project. */
  isOwner: boolean;
  /** Reason `fetched: false` — only populated when `fetched: false`. */
  reason?: 'not_found' | null;
  /** Remote-side project snapshot. Required when `fetched: true`. */
  project?: {
    name: string;
    description: string | null;
    createdAt: string;
    /** Owner-only — backend strips for non-owner. */
    lastReleaseAt?: string;
    /** Owner-only — backend strips for non-owner. */
    owner?: { email: string; name?: string };
  };
}

/**
 * Body of `PATCH /api/remote-project`. At least one of `name`/`description`
 * must be present; an empty body is rejected locally with 422 INVALID_BODY
 * before any peer call. `description: null` clears the column on the peer;
 * an omitted key leaves it unchanged.
 */
export interface UpdateRemoteProjectRequest {
  /** 1..120 chars (peer-spec M04 limit). */
  name?: string;
  /** 0..1000 chars; `null` clears the column. */
  description?: string | null;
}
