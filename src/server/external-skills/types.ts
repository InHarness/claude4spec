/**
 * 0.1.103 M22 — injected project identity for the generated external skills
 * (`c4s-spec-reader`, `c4s-brief-implementer`, `c4s-refactor`). Lets a
 * skill copied into a FOREIGN code repo (where `.claude4spec/` doesn't exist)
 * carry `--project <slug> --workspace <name>` and absolute fallback paths,
 * instead of relying on directory walk-up from the agent's cwd.
 */
export interface ExternalSkillContext {
  /** `ProjectRecord.name` — the registered, path-safe selector for `--project <slug>`. */
  slug: string;
  /** `WorkspaceRecord.name` — the selector for `--workspace <name>`. */
  workspace: string;
  /** Absolute `briefsDir` — fallback for `c4s list-briefs`/`read-brief` when `c4s` is unavailable. */
  briefsDirAbs: string;
  /** Absolute `patchesDir` — fallback for `c4s file-patch` when `c4s` is unavailable. */
  patchesDirAbs: string;
  /** Absolute built-in `pages` root dir, when present — fallback for `c4s-refactor`/`c4s-spec-reader`. */
  pagesDirAbs?: string;
  /** Absolute path of the spec repo's generated `.claude4spec/mcp.json` (not a file in the foreign code repo). */
  mcpJsonAbs: string;
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
}
