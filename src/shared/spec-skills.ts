/**
 * 2.1.9 (M52) — wire types shared by the server route and the settings card.
 */

/**
 * DTO `exposed-project-row` — one row of the list of projects exposed as a skill,
 * seen from the current project. The list also carries the `skill.uses`
 * attachments that do not resolve.
 *
 *  - `ok` — the name resolves to exactly one provider;
 *  - `unavailable` — no project exposes this name (a dangling attachment);
 *  - `ambiguous` — more than one project exposes it (it then resolves to none).
 */
export type ExposedProjectStatus = 'ok' | 'unavailable' | 'ambiguous';

export interface ExposedProjectRow {
  /** The provider's `skill.name` — the attachment's address; for a dangling one, the name written in `skill.uses`. */
  name: string;
  /** The provider's `skill.description`; absent on a dangling attachment. */
  description?: string;
  /** The provider's project id; absent on a dangling or ambiguous attachment. */
  projectId?: string;
  /** Whether the current project has this name in `skill.uses`. */
  uses: boolean;
  status: ExposedProjectStatus;
}

/**
 * DTO `fork-writing-style-request` — `POST /api/spec-skills/style-forks`, the
 * `rest` rendering of `fork_writing_style` (sheet `katalog-operacji-m52`, row 3).
 */
export interface ForkWritingStyleRequest {
  /**
   * Slug of the writing style from a plugin to copy; the local package gets the
   * same slug. It need not equal `config.writingStyle` — the operation does not
   * compare it with the active style (2.1.17).
   */
  slug: string;
}

/**
 * DTO `fork-writing-style-response` — the address of the copy (201). Echo-free:
 * the copy's content is never carried back.
 */
export interface ForkWritingStyleResponse {
  /** Slug of the package created in the `skills` root. */
  slug: string;
  /** Path of the package's `SKILL.md`, relative to the `skills` root. */
  path: string;
}

/**
 * 2.1.57 (M52 `ybbal0vf`, M31 `44viw74p`) — `GET|PUT /api/spec-skills/hook-trust`:
 * whether this machine confirmed the skill attachments (`skill.uses`) of the
 * project's committed config. Machine-local (the workspace registry record), never
 * in the repository. ASSUMPTION:dev-0002 — one confirmation for the whole list,
 * given on the `#skills` settings card.
 */
export interface SpecSkillHookTrust {
  trusted: boolean;
}
