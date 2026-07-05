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
