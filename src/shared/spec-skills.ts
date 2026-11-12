/**
 * 2.1.9 (M52) — wire types shared by the server route and the settings card.
 */

/**
 * DTO `exposed-project-row` — one row of the list of projects exposed as a skill,
 * seen from the current project. The list also carries the `skill.uses`
 * attachments that do not resolve and (2.1.69) the names confirmed on this
 * machine that neither `skill.uses` carries nor any project exposes
 * (`status: unavailable`, `uses: false`, `confirmed: true`).
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
  /**
   * 2.1.86: the slug of the provider's project type, from the type copy in the
   * workspace record — what the UI groups the row by. Present exactly when
   * `status` is `ok`, like `projectId`.
   */
  projectType?: string;
  /** Whether the current project has this name in `skill.uses`. */
  uses: boolean;
  status: ExposedProjectStatus;
  /**
   * 2.1.67 (M52 `uluzymnm`): whether the name is confirmed on this machine in the
   * project's trust (`confirmedSkillUses`, M31 registry) — attached or not (2.1.69).
   */
  confirmed: boolean;
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
 * 2.1.67 (M52 `uluzymnm`, `qtq9iusb`) — DTO `skill-uses-confirmation-request`,
 * the body of `PUT /api/spec-skills/uses-confirmation`: the attachment names
 * confirmed on this machine for the current project. It REPLACES the stored list
 * whole; `[]` withdraws every confirmation. Each name in the `skill.name` syntax.
 */
export interface SkillUsesConfirmationRequest {
  names: string[];
}

/**
 * DTO `skill-uses-confirmation-response` — the project's confirmations after the
 * write: the stored list, and apart the confirmed names the project's
 * `skill.uses` does not carry (not an error).
 */
export interface SkillUsesConfirmationResponse {
  confirmedSkillUses: string[];
  notInSkillUses: string[];
}
