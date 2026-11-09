/**
 * M31 — the ONE sanctioned read of another project's `config.json`.
 *
 * Reaching into a peer project's directory from outside its ProjectContext is a
 * documented departure from the no-ambient rule, and a departure the schema
 * check cannot see: no object is created, so nothing acquires a lifetime or a
 * key that could be inspected. It survives because the alternative is worse.
 * `list_projects` must answer for every project in the workspace WITHOUT
 * building a context for any of them — a build would raise
 * `PROJECT_BUILD_FAILED` where the contract requires a degraded entry — and the
 * three callers each read every peer at once, so a build-per-peer would also
 * blow the live-context budget on a plain workspace listing.
 *
 * What was wrong was not the read but that it was open-coded in three places,
 * each with its own try/catch and its own idea of what a failure means. This is
 * that read, named once, so the departure has a single site to point at.
 *
 * Read-only and side-effect-free: it neither activates the project, nor builds
 * a context, nor writes the config back.
 */

import { DEFAULT_PROJECT_TYPE, normalizeSkillConfig, readConfig, type NormalizedSkillConfig } from '../config.js';
import type { PeerProject } from '../services/system-prompt/types.js';
import type { ProjectRecord } from './types.js';

export interface PeerConfigSummary {
  /** Display name from the peer's `config.json`. Absent when it cannot be read. */
  name?: string;
  /** Display description. Absent when unset or unreadable. */
  description?: string;
}

/**
 * The peer's display fields, or an empty summary when its config is unreadable.
 *
 * Never throws. A malformed `config.json` degrades to an entry without `name`
 * rather than to an error, because one broken project must not make the whole
 * workspace unlistable — that would remove the only discovery path at exactly
 * the moment something is wrong. Note that "cannot be read" means MALFORMED,
 * not absent: `readConfig` defaults a missing file to the directory basename,
 * and that default is kept — a usable label beats a blank one.
 */
export function readPeerConfigSummary(cwd: string): PeerConfigSummary {
  try {
    const cfg = readConfig(cwd);
    const summary: PeerConfigSummary = {};
    if (cfg.name) summary.name = cfg.name;
    if (cfg.description) summary.description = cfg.description;
    return summary;
  } catch {
    return {};
  }
}

/**
 * 2.1.9 (M52 `ybbal0vf`) — the peer's `skill.*` (exposure fields and
 * attachments) with defaults applied, or `null` when its config cannot be read:
 * an unreadable project exposes nothing. The same sanctioned read as
 * {@link readPeerConfigSummary}, kept in this file so the departure keeps its
 * single site; M52 builds its list of exposed projects
 * (`services/exposed-projects.ts`) on top of it and never opens a peer's
 * `config.json` itself.
 */
export function readPeerSkillConfig(cwd: string): NormalizedSkillConfig | null {
  try {
    return normalizeSkillConfig(readConfig(cwd));
  } catch {
    return null;
  }
}

/**
 * 0.1.58 / 2.1.77 — the peers of `<workspace_projects>`: every workspace project
 * except the current one, addressed by its registry `id` alone. `name` and
 * `description` come from the peer's own `config.json` through `readSummary`
 * (the sanctioned read above; unreadable → no label, not an error). `type`
 * (M31 `qtqqqwfp`, `gofah0an`) comes from the copy of the type in the peer's
 * REGISTRY RECORD — never from its `config.json` — written verbatim, known slug
 * or not; a record without a copy is a `spec`. No directory: a path is not an
 * address and never reaches the agent.
 */
export function workspacePeers(
  projects: readonly Pick<ProjectRecord, 'id' | 'cwd' | 'projectType'>[],
  currentProjectId: string,
  readSummary: (cwd: string) => PeerConfigSummary,
): PeerProject[] {
  return projects
    .filter((p) => p.id !== currentProjectId)
    .map((p) => {
      const peer: PeerProject = { id: p.id };
      const { name, description } = readSummary(p.cwd);
      if (name) peer.name = name;
      if (description) peer.description = description;
      peer.type = p.projectType ?? DEFAULT_PROJECT_TYPE;
      return peer;
    });
}
