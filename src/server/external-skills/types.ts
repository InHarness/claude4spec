/**
 * 0.1.103 M22 — injected project identity for the generated external skills
 * (`c4s-spec-reader`, `c4s-brief-implementer`, `c4s-refactor`). Lets a
 * skill copied into a FOREIGN code repo (where `.claude4spec/` doesn't exist)
 * carry its address instead of relying on directory walk-up from the agent's
 * cwd. 2.1.0: the address is `--server <publicUrl> --project <id>` — no slug,
 * no directory; a skill generated after the spec repo moved is identical.
 *
 * 0.1.106: narrowed to just the identity — the three skills are now strictly
 * CLI-only (no filesystem fallback, no copy-paste MCP setup), so there's
 * nothing left needing an absolute path.
 */
export interface ExternalSkillContext {
  /** 2.1.0: `ProjectRecord.id` — the registry id, injected as `--project <id>`. */
  id: string;
  /**
   * `WorkspaceRecord.name`. NOT passed to `c4s` when `--server` is used (the
   * server implies its workspace); kept for display and troubleshooting text.
   */
  workspace: string;
  /** 2.1.0: effective `publicUrl` of the workspace — injected as `--server <publicUrl>`. */
  publicUrl: string;
}

/** 0.1.104 M22 — the three skills renderable via `buildExternalSkillsBundle`. */
export type SkillSlug = 'spec-reader' | 'brief-implementer' | 'refactor';

/** relPath (e.g. `c4s-spec-reader/SKILL.md`) -> file content. No disk writes, no side effects. */
export type FileSet = Map<string, string>;

/** Metadata-only summary for `GET /api/external-skills` — no SKILL.md content. */
export interface ExternalSkillSummary {
  slug: SkillSlug;
  name: string;
  description: string;
}

export interface ExternalSkillsListResponse {
  skills: ExternalSkillSummary[];
  /**
   * 2.1.0 — the `--project <id>` the generated skills are baked with, for the
   * settings card's "Same from the terminal" hint. `null` when the project is
   * not registered yet.
   */
  projectId: string | null;
}
