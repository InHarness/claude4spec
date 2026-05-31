/**
 * M27 Project Clone — DTO for `release_import` audit rows. Reverse-direction peer
 * of {@link ReleasePushResponse}: push sends local → remote, clone pulls remote →
 * local. v1 has no HTTP/UI surface (the log is visible only via the SQLite file);
 * this shape is forward-looking for a possible v2 read-only `/api/release-imports/*`.
 *
 * The earlier a clone fails, the more fields are absent — every field except
 * `remoteProjectSlug`, `status`, and `importedAt` is optional.
 */
export interface ReleaseImportResponse {
  id: number;
  /** FK to the local release #1 created by the clone; absent if the clone failed before it. */
  localReleaseId?: number;
  /** Nested snapshot of the local release meta (saves the UI a fetch). */
  localRelease?: { id: number; name: string };
  /** UUID on the remote — the stable key (the slug is mutable). */
  remoteProjectId?: string;
  /** User input — always known. */
  remoteProjectSlug: string;
  remoteReleaseId?: string;
  remoteReleaseSequence?: number;
  /** lowercase hex64. */
  contentSha256?: string;
  contentSizeBytes?: number;
  /** From the bundle manifest (NOT an HTTP header). */
  bundleSchemaVersion?: number;
  /** NULL for the anonymous v1 clone. */
  importedByAccountId?: string;
  /** NULL for the anonymous v1 clone. */
  importedByAccountEmail?: string;
  status: 'success' | 'error';
  /** Only for status='error' — the error code. */
  errorMessage?: string;
  /** ISO 8601. */
  importedAt: string;
}

/** Response of a future `GET /api/release-imports`. */
export interface ReleaseImportListResponse {
  items: ReleaseImportResponse[];
}
