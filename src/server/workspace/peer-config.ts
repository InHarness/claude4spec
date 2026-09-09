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

import { readConfig } from '../config.js';

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
