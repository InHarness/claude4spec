import fs from 'node:fs';
import path from 'node:path';

/**
 * 2.1.9 (M11 `m11askrul`) — the `answer` of an `ask` turn, on the PEER's side.
 *
 * Two guarantees of the consultation hold here, in the one place every
 * transport (`c4s ask`, `c4s agent --ct ask`, MCP `c4s-tools.ask`) goes through
 * — `POST /api/threads/:id/ask` — rather than in each caller:
 *
 *  1. A turn that LEFT a plan (created one, or changed one) names that plan in
 *     its `answer`, by its path RELATIVE TO THE PEER PROJECT. The interaction
 *     rules ask the agent to do so; when its last message does not, the path is
 *     appended as a closing line, so the caller always learns where the plan is.
 *  2. The `answer` never carries the peer project's directory (M31 #16: a peer
 *     is addressed by its registry `id`, never by its path). Every occurrence of
 *     the project directory is rewritten relative to the project — an absolute
 *     path inside the project becomes a project-relative one, the bare
 *     directory becomes `.`.
 *
 * ASSUMPTION:dev-0601 — the specification states both as a rule of the turn
 * (the `<interaction_context type="ask">` body tells the agent); enforcing them
 * here, deterministically, is this implementation's backstop. "Left a plan" =
 * a plan created or changed during the turn; "the project directory" is the
 * peer's `cwd`, under its given and its real spelling.
 *
 * Pure apart from one `realpathSync` (a symlinked project dir is scrubbed under
 * both spellings).
 */

/** Plans as they stood before the turn: path (relative to the `plans` root) → content hash. */
export type PlanSnapshot = Map<string, string>;

/** The two `PlanService` reads this needs — kept narrow so a test can hand a stub. */
export interface AskPlanSource {
  readonly rootDir: string;
  listPlans(): Array<{ path: string; hash: string }>;
}

export function snapshotPlans(plans: AskPlanSource | undefined): PlanSnapshot {
  const out: PlanSnapshot = new Map();
  if (!plans) return out;
  try {
    for (const p of plans.listPlans()) out.set(p.path, p.hash);
  } catch {
    // A plans root that cannot be listed leaves nothing to report — the answer
    // still gets its directory scrubbed.
  }
  return out;
}

/** Plans created or changed between the two snapshots, as paths relative to the `plans` root. */
export function plansLeftByTurn(before: PlanSnapshot, after: PlanSnapshot): string[] {
  const left: string[] = [];
  for (const [p, hash] of after) {
    if (before.get(p) !== hash) left.push(p);
  }
  return left.sort();
}

/** A plan path (relative to the `plans` root) as a path relative to the project, POSIX separators. */
export function projectRelativePlanPath(projectDir: string, plansRootDir: string, planPath: string): string {
  return path.relative(projectDir, path.join(plansRootDir, planPath)).split(path.sep).join('/');
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Every spelling of the project directory the answer could carry, longest first. */
function projectDirSpellings(projectDir: string): string[] {
  const spellings = new Set<string>();
  const add = (d: string) => {
    const trimmed = d.replace(/[\\/]+$/, '');
    if (trimmed.length > 1) {
      spellings.add(trimmed);
      spellings.add(trimmed.split(path.sep).join('/'));
    }
  };
  add(path.resolve(projectDir));
  try {
    add(fs.realpathSync(projectDir));
  } catch {
    // A directory that cannot be resolved has only its given spelling.
  }
  return [...spellings].sort((a, b) => b.length - a.length);
}

/**
 * Rewrites every occurrence of the project directory relative to the project:
 * `<dir>/x/y` → `x/y`, a bare `<dir>` → `.`.
 */
export function scrubProjectDir(answer: string, projectDir: string): string {
  let out = answer;
  for (const dir of projectDirSpellings(projectDir)) {
    const d = escapeRegExp(dir);
    // `<dir>/rest` → `rest` (a separator followed by more path).
    out = out.replace(new RegExp(`${d}[\\\\/]+(?=[^\\s\`'")\\]])`, 'g'), '');
    // What is left is the bare directory (optionally with a trailing separator)
    // — but not a longer sibling name such as `<dir>-old` or `<dir>.bak`; a
    // sentence-ending dot after it is punctuation, not part of a name.
    out = out.replace(new RegExp(`${d}[\\\\/]*(?![\\w-]|\\.\\w)`, 'g'), '.');
  }
  return out;
}

export interface FinalizeAskAnswerInput {
  answer: string;
  /** The peer project's directory (`AgentTurnDeps.cwd`). */
  projectDir: string;
  /** The `plans` root directory. Absent → no plan reporting (scrub only). */
  plansRootDir?: string;
  /** Plans the turn left, relative to the `plans` root (`plansLeftByTurn`). */
  plansLeft: string[];
}

export function finalizeAskAnswer(input: FinalizeAskAnswerInput): string {
  const answer = scrubProjectDir(input.answer, input.projectDir);
  const plansRootDir = input.plansRootDir;
  if (!plansRootDir) return answer;
  const missing = input.plansLeft
    .map((p) => projectRelativePlanPath(input.projectDir, plansRootDir, p))
    .filter((rel) => !answer.includes(rel));
  if (missing.length === 0) return answer;
  const lines = missing.map((rel) => `Plan: \`${rel}\``).join('\n');
  return answer.trim().length > 0 ? `${answer.replace(/\s+$/, '')}\n\n${lines}` : lines;
}
