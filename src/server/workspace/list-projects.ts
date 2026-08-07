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
 * ## `slug` vs `name`
 *
 * `slug` is the registry's own name for the project — the string
 * `c4s --project <slug>` matches, so it is always present. `name` is the display
 * name from the project's `config.json`, so it is the field that goes missing
 * when that file cannot be read. Keeping them apart is what lets a project stay
 * addressable even when its config is broken.
 */

import { readConfig } from '../config.js';
import type { WorkspaceRecord } from './types.js';

export interface ProjectListItem {
  /** `projectIdForCwd(cwd)` — the `:id` segment of every project-scoped route. */
  id: string;
  /** The registry's name for the project; what `--project <slug>` resolves against. */
  slug: string;
  /** Display name from the project's `config.json`. Absent when it cannot be read. */
  name?: string;
  /** Absolute project directory. */
  path: string;
}

export interface ListProjectsResult {
  projects: ProjectListItem[];
}

export function listProjects(workspace: WorkspaceRecord): ListProjectsResult {
  return {
    projects: workspace.projects.map((p) => {
      const item: ProjectListItem = { id: p.id, slug: p.name, path: p.cwd };
      try {
        const cfg = readConfig(p.cwd);
        if (cfg.name) item.name = cfg.name;
      } catch {
        // Unreadable/missing/invalid config → entry without `name`. Deliberately
        // not an error: see the module note above.
      }
      return item;
    }),
  };
}
