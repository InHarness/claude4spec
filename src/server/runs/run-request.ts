/**
 * `c4s-runner` dto `run-request` — the body of `PUT /runs/{runId}`, as the
 * master builds it. Paths are relative to the workspace home (`home` is the
 * home relative to the repository root, `.` when they are the same); `repo`,
 * `home` and `baseSha` are computed by the master (M55 `ffb3rhrs`). An absent
 * optional field is left out of the body, never sent as `null`.
 */
export type RunInput = { kind: 'plan'; path: string } | { kind: 'prompt'; text: string; projectId?: string };

export interface RunRequest {
  repo: string;
  home: string;
  baseSha: string;
  agent: { name: string; version: string; content: string };
  input: RunInput;
  notes?: string;
  timeoutMinutes?: number;
  model?: string;
}
