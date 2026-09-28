/**
 * M31 — the `list_projects` catalog operation.
 *
 * M31 is its sole owning core. Its presence in a catalog otherwise defined as
 * "the subject is specification content" is a declared NAVIGATIONAL EXCEPTION:
 * the subject here is the workspace registry. It earns the exception because
 * without it the project-scoped catalog is unreachable from outside — every
 * other operation needs a project id, and nothing else hands one out.
 *
 * ## No pagination, no error codes
 *
 * A workspace holds a handful of projects, not a feed. More importantly: an
 * unreadable or malformed `config.json` yields an entry WITHOUT `name`, never a
 * failure. One broken project must not make the workspace unlistable — that
 * would take the only discovery path away exactly when something is wrong.
 *
 * ## `id` vs `name` (2.1.0)
 *
 * `id` is the project's only address — the value passed as `project` to the
 * `ask` tool, as `--project` to `c4s`, and the `/api/projects/<id>` prefix. It
 * is always present. `name` is the display label from the project's
 * `config.json` — never a selector — so it is the field that goes missing when
 * that file cannot be read. The project directory is NOT returned, in any
 * channel, not even for the caller's own project: a directory is not an address.
 *
 * Reads the registry only; builds no `ProjectContext` for any listed project.
 *
 * "Cannot be read" means MALFORMED, not absent. `readConfig` throws on invalid
 * JSON but defaults a missing `config.json` to the directory's basename, and
 * this operation keeps that default rather than suppressing it — a usable label
 * beats a blank one, and it is the behaviour peer discovery
 * (`listWorkspacePeers`) has always had for the same field.
 */

import { readPeerConfigSummary } from './peer-config.js';
import type { WorkspaceRecord } from './types.js';

export interface ProjectListItem {
  /** Registry id — the `project` argument of `ask`, the `:id` of project-scoped routes. */
  id: string;
  /** Display name from the project's `config.json`. Absent when it cannot be read. */
  name?: string;
  /** Display description from `config.json`. Absent when unset or unreadable. */
  description?: string;
}

export interface ListProjectsResult {
  /** The workspace served by THIS server instance. */
  workspace: string;
  projects: ProjectListItem[];
}

export function listProjects(workspace: WorkspaceRecord): ListProjectsResult {
  return {
    workspace: workspace.name,
    projects: workspace.projects.map((p) => {
      const item: ProjectListItem = { id: p.id };
      // Unreadable/invalid config → entry without `name`, never an error. The
      // degradation lives in `readPeerConfigSummary`, the one sanctioned read of
      // a peer's config; see the module note above for why it is not an error.
      const { name, description } = readPeerConfigSummary(p.cwd);
      if (name) item.name = name;
      if (description) item.description = description;
      return item;
    }),
  };
}
