/**
 * 2.1.77 (M57 L4, DTO `project-type-list-response`): the answer of
 * `GET /api/workspace/project-types` — the project-type registry in registry
 * order, for the type cards of the create-project page. It carries descriptive
 * data only: neither the prompt description nor the capability set.
 */
export interface ProjectTypeCard {
  /** The type's slug, kebab-case; the `projectType` value at registration. */
  slug: string;
  /** The type's name, in English. */
  name: string;
  /** The description for the user, in English. */
  description: string;
}

export interface ProjectTypeListResponse {
  /** The registry's entries, one per type, in registry order. */
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
