/**
 * 2.1.62 (M54 L4) — the DTOs of `/api/workspace/runner-hosts`, shared by the
 * server router and the client. The token only ever travels TO the server
 * (create, update); every answer carries its mask (`isSet`, `last4`), never the
 * token and never its ciphertext (`qc6t2y7m`).
 */

/**
 * The closed set of ten statuses (`nbpe2o7c`, column "Wartość `status`"). The
 * supervisor derives them; they live in its memory only.
 */
export type RunnerHostStatus =
  | 'connecting'
  | 'connected'
  | 'unreachable'
  | 'retrying'
  | 'stopped'
  | 'token-rejected'
  | 'token-unreadable'
  | 'protocol-mismatch'
  | 'other-host'
  | 'bad-response';

/** DTO `create-runner-host-request` — `POST /api/workspace/runner-hosts`. */
export interface CreateRunnerHostRequest {
  /** Base address of the host (`kqxtylk6`). */
  url: string;
  /** Master token; non-empty. */
  token: string;
  /** Optional label. */
  label?: string;
}

/**
 * DTO `update-runner-host-request` — `PATCH /api/workspace/runner-hosts/:id`.
 * A field left out stays as it is; an empty `token` means "no change".
 */
export interface UpdateRunnerHostRequest {
  url?: string;
  token?: string;
  label?: string;
}

/** DTO `test-runner-host-request` — `POST /api/workspace/runner-hosts/:id/test`. */
export interface TestRunnerHostRequest {
  /** Explicit consent to store a new binding when the host answers with another `hostId`. */
  rebind?: boolean;
}

/** The binding to the host; `startedAt` is the value seen last. */
export interface RunnerHostBindingDto {
  hostId: string;
  hostName: string;
  runnerVersion: string;
  startedAt: string;
}

/**
 * DTO `runner-host-response` — a record with its configuration, binding and
 * the supervisor's state. `status`, `statusSince`, `lastEventAt`, `lastError`
 * and `restartedAt` come from the supervisor's memory, not from the file.
 */
export interface RunnerHostResponse {
  /** Local id of the record, given on add, never changed. */
  id: string;
  /** Normalized base address. */
  url: string;
  label?: string | null;
  /** The token's mask: whether one is set and its last four characters. */
  token: { isSet: boolean; last4: string | null };
  /** `null` until the first successful attempt and after a new token is saved. */
  binding: RunnerHostBindingDto | null;
  status: RunnerHostStatus;
  /** ISO-8601: entering the current status. */
  statusSince: string;
  /** ISO-8601 of the stream's last event. */
  lastEventAt: string | null;
  /** The last error, its text scrubbed of the token. */
  lastError: { code: string; message: string } | null;
  /** ISO-8601 of the runner restart the master noticed last (`i084ojn6`); `null` after every binding change. */
  restartedAt: string | null;
}

/** DTO `remove-runner-host-response` — `DELETE /api/workspace/runner-hosts/:id`. */
export interface RemoveRunnerHostResponse {
  /** Id of the removed record. */
  id: string;
}
