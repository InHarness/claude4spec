/**
 * M25/M26 — shape of `GET /api/remote-project`. Local proxy DTO that joins
 * `config.remoteProjectId` (M01) with the M24 remote-account session status
 * and an optional snapshot of the upstream project. Four states surfaced by
 * the discriminating fields `linked` × `fetched` × `reason` — see the brief
 * §5 table.
 */
export interface RemoteProjectInfo {
  /** True iff `config.remoteProjectId` is non-null. */
  linked: boolean;
  /** UUID from `config.remoteProjectId`. `null` when `linked: false`. */
  projectId: string | null;
  /** True iff the backend actually fetched remote project data. */
  fetched: boolean;
  /** Reason `fetched: false` — only populated when `fetched: false`. */
  reason?: 'not_connected' | 'not_found' | null;
  /** Remote-side project snapshot. Required when `fetched: true`. */
  project?: {
    name: string;
    createdAt: string;
    lastReleaseAt?: string;
    owner?: { email: string; name?: string };
  };
}
