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
