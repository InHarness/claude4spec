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

/**
 * `c4s-runner` dto `run-request`, field `c4sTrust` (`c4s-runner` `modules/M06-runs.md`
 * #m8krfttx): the c4s trust approved locally by the master, keyed by the
 * `projectId` of `workspace.json`. `path` is the project path relative to the
 * workspace home that the consent was given for; `trustProjectPlugins` the
 * plugin trust; `skillAttachments` the confirmed skill-attachment names.
 * M55 (`jlgucjnq`) sends at most one entry — the Run's project.
 */
export interface C4sTrustEntry {
  path: string;
  trustProjectPlugins?: boolean;
  skillAttachments?: string[];
}

export interface C4sTrust {
  projects: Record<string, C4sTrustEntry>;
}

/**
 * `c4s-runner` dto `run-request`, field `continuation` (2.1.68, M55 `ffb3rhrs`):
 * a continuation Run — `parentRunId` is the runId of the direct parent whose
 * result is the Run's base (`baseSha` = the tip of the parent's result ref);
 * `instruction` the optional instruction for the agent, left out when not given.
 */
export interface RunContinuation {
  parentRunId: string;
  instruction?: string;
}

export interface RunRequest {
  repo: string;
  home: string;
  baseSha: string;
  agent: { name: string; version: string; content: string };
  input: RunInput;
  notes?: string;
  timeoutMinutes?: number;
  model?: string;
  /** Absent = the Run's c4s registry carries no trust (`jlgucjnq`). */
  c4sTrust?: C4sTrust;
  /** Only on a continuation Run (`fromRunId`); absent otherwise. */
  continuation?: RunContinuation;
}
