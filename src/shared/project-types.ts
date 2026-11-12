/**
 * 2.1.77 (M57 L4, DTO `project-type-list-response`): the answer of
 * `GET /api/workspace/project-types` — the project-type registry in registry
 * order (2.1.86: ascending by each entry's position), for the type cards of the
 * create-project page and the type groups of the project lists (their headers
 * and their order). It carries descriptive data only: neither the prompt
 * description, nor the capability set, nor the position — the array order is
 * the only carrier of the order, and the client keeps it as it comes.
 */
export interface ProjectTypeCard {
  /** The type's slug, kebab-case; the `projectType` value at registration. */
  slug: string;
  /** The type's name, in English; the type card and the type's group header. */
  name: string;
  /** The description for the user, in English. */
  description: string;
}

export interface ProjectTypeListResponse {
  /** The registry's entries, one per type, ascending by position. */
  types: ProjectTypeCard[];
}

/**
 * 2.1.77 (M57 `rdztxzb8`, M26 `vm9rajvn`): THE active-row rule — a settings row
 * (server field, client card or element) is active when every capability its
 * `requires` names is in the project's set. The one implementation: the server
 * field registry and the client card registry both call it.
 */
export function satisfies(capabilities: ReadonlySet<string>, requires: readonly string[] | undefined): boolean {
  return (requires ?? []).every((c) => capabilities.has(c));
}

/**
 * 2.1.77 (dto `add-project-request`): the body of `POST /api/workspace/projects`.
 * `projectType` present = the new-project path (the directory must have no
 * `config.json`; the type goes to the activation's bootstrap set and to the
 * record's copy); absent = the existing-directory path (the directory must have
 * `config.json`; the type comes from it, no key = Specification). A slug
 * outside the type registry → `PROJECT_TYPE_UNKNOWN`.
 */
export interface AddProjectRequest {
  cwd: string;
  projectType?: string;
}

/** dto `add-project-response`: the stored id the UI navigates to (`/p/<projectId>/`). */
export interface AddProjectResponse {
  projectId: string;
}
