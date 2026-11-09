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
