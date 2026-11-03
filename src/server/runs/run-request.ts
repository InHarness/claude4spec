/**
 * `c4s-runner` dto `run-request` — the body of `PUT /runs/{runId}`, as the
 * master builds it. `home` is the workspace home relative to the repository
 * root (`.` when they are the same); `repo`, `home` and `baseSha` are computed
 * by the master (M55 `ffb3rhrs`). Both inputs always carry `projectId`; a
 * plan's `path` is relative to the plans directory of that project
 * (`<project path>/.claude4spec/plans/`) — the thread's `planPath`, never
 * recomputed. An absent optional field is left out of the body, never sent as
 * `null`.
 */
export type RunInput = { kind: 'plan'; projectId: string; path: string } | { kind: 'prompt'; projectId: string; text: string };

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
