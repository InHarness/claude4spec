/**
 * M52 — the projects of a workspace exposed as a skill, and how an attachment
 * (`skill.uses` entry) resolves against them (2.1.9, `ybbal0vf`, `9j9cxrsr`,
 * `gx7f584v`, `rkbsi6ky`).
 *
 * A provider is addressed by its `skill.name`, never by its project id or path:
 * an attachment survives the provider's directory moving, not its rename. An
 * attachment resolves when exactly one OTHER project of the workspace exposes
 * the name; none → dangling (`unavailable`), more than one → ambiguous (resolves
 * to none). Attaching oneself is ignored. Neither dangling nor ambiguous is an
 * error: it is a warning, because a change in someone else's project must not
 * stop this one.
 *
 * The exposure of every project comes from the M31 project list through the one
 * sanctioned peer-config read (`workspace/peer-config.ts`) — this module never
 * opens a `config.json` itself. Attachments are not transitive: only the current
 * project's own `skill.uses` is read.
 */

import type { ExposedProjectRow } from '../../shared/spec-skills.js';
import type { NormalizedSkillConfig } from '../config.js';
import { readPeerSkillConfig } from '../workspace/peer-config.js';

/** A project of the workspace as the M31 registry lists it (no other field is needed). */
export interface WorkspaceProjectRef {
  id: string;
  cwd: string;
}

/** A project of the workspace that exposes itself as a skill, with a usable name. */
export interface ExposedProject {
  projectId: string;
  /** `skill.name` — the attachment address. */
  name: string;
  description: string | null;
  entry: string;
  scope: 'writing-style' | 'contextual';
  /** `undefined` ⇒ all four context types. */
  contextTypes: string[] | undefined;
}

/** The exposure of a skill config, or `null` when the project is not exposed (or has no name to be addressed by). */
export function exposureOf(projectId: string, skill: NormalizedSkillConfig | null): ExposedProject | null {
  if (!skill || !skill.exposed || skill.name === null) return null;
  return {
    projectId,
    name: skill.name,
    description: skill.description,
    entry: skill.entry,
    scope: skill.scope,
    contextTypes: skill.contextTypes,
  };
}

/**
 * Every project of the workspace exposed as a skill — `skill.exposed` on and a
 * `skill.name` set — in the registry's order. An unreadable config exposes
 * nothing. Read live: a provider switching its exposure off, or renaming, is seen
 * by the next call.
 */
export function listExposedProjects(
  projects: readonly WorkspaceProjectRef[],
  readSkill: (cwd: string) => NormalizedSkillConfig | null = readPeerSkillConfig,
): ExposedProject[] {
  const out: ExposedProject[] = [];
  for (const p of projects) {
    const exposed = exposureOf(p.id, readSkill(p.cwd));
    if (exposed) out.push(exposed);
  }
  return out;
}

/** How one attachment of the consumer resolves. */
export type AttachmentResolution =
  | { name: string; status: 'ok'; provider: ExposedProject }
  | { name: string; status: 'unavailable' }
  | { name: string; status: 'ambiguous'; providers: ExposedProject[] }
  | { name: string; status: 'self' }
  | { name: string; status: 'unconfirmed' };

/**
 * Resolve the consumer's attachments against the exposed projects. `self` — the
 * consumer's own exposed `skill.name` (`ownName`, from its own config) — is
 * reported apart (ignored with a warning by the callers), whatever other project
 * shares the name.
 *
 * 2.1.67 (M52 `uluzymnm`, `ybbal0vf`): `confirmed` is the list of attachment
 * NAMES this machine confirmed for the project (`confirmedSkillUses`, M31
 * `44viw74p`). A name is confirmed, not the list: an attachment whose name is not
 * on it — one a commit added next to confirmed ones included — is `unconfirmed`:
 * it resolves to no provider, whatever the workspace exposes, and the callers
 * warn as for a dangling one. A confirmed name absent from `uses` does nothing.
 *
 * Duplicate names in `uses` collapse to one attachment.
 */
export function resolveAttachments(
  consumerId: string,
  uses: readonly string[],
  ownName: string | null,
  exposed: readonly ExposedProject[],
  confirmed: readonly string[],
): AttachmentResolution[] {
  const ok = new Set(confirmed);
  const out: AttachmentResolution[] = [];
  for (const name of new Set(uses)) {
    if (ownName !== null && name === ownName) {
      out.push({ name, status: 'self' });
      continue;
    }
    if (!ok.has(name)) {
      out.push({ name, status: 'unconfirmed' });
      continue;
    }
    const providers = exposed.filter((p) => p.name === name && p.projectId !== consumerId);
    if (providers.length === 1) out.push({ name, status: 'ok', provider: providers[0]! });
    else if (providers.length === 0) out.push({ name, status: 'unavailable' });
    else out.push({ name, status: 'ambiguous', providers });
  }
  return out;
}

/**
 * Operation `list_exposed_projects` (sheet `katalog-operacji-m52`, row 4): the
 * exposed projects of the workspace with the status of the current project's
 * attachments. One row per name:
 *
 *  - every name exposed by another project — `ok` with its provider's id and
 *    description, or `ambiguous` (no id, no description) when several share it;
 *  - every `skill.uses` entry no project exposes — `unavailable`, `uses: true`.
 *
 * The current project has no row (attaching oneself is not offered), and neither
 * has its own name when it sits in its `uses`. Sorted by name; one answer, no
 * paging — the list is short by nature and an incomplete one would be useless
 * for choosing attachments.
 *
 *  - 2.1.69 (M52 `qtq9iusb`): every name confirmed on this machine that the
 *    project's `skill.uses` does not carry and no other project exposes — an
 *    unattached row, `unavailable`, `uses: false`, `confirmed: true`.
 *
 * Each row carries `confirmed` — the name is confirmed on this machine in the
 * project's trust (`confirmedSkillUses`), attached or not (2.1.69: unticking a
 * row takes the attachment off, not the confirmation).
 */
export function listExposedProjectRows(
  consumerId: string,
  uses: readonly string[],
  exposed: readonly ExposedProject[],
  confirmedNames: readonly string[],
): ExposedProjectRow[] {
  const used = new Set(uses);
  const confirmedSet = new Set(confirmedNames);
  const confirmed = (name: string): boolean => confirmedSet.has(name);
  const own = exposed.find((p) => p.projectId === consumerId)?.name ?? null;
  const byName = new Map<string, ExposedProject[]>();
  for (const p of exposed) {
    if (p.projectId === consumerId) continue;
    byName.set(p.name, [...(byName.get(p.name) ?? []), p]);
  }
  const rows: ExposedProjectRow[] = [];
  for (const [name, providers] of byName) {
    if (name === own) continue;
    if (providers.length === 1) {
      const p = providers[0]!;
      rows.push({
        name,
        ...(p.description !== null ? { description: p.description } : {}),
        projectId: p.projectId,
        uses: used.has(name),
        status: 'ok',
        confirmed: confirmed(name),
      });
    } else {
      rows.push({ name, uses: used.has(name), status: 'ambiguous', confirmed: confirmed(name) });
    }
  }
  for (const name of used) {
    if (name === own || byName.has(name)) continue;
    rows.push({ name, uses: true, status: 'unavailable', confirmed: confirmed(name) });
  }
  for (const name of confirmedSet) {
    if (name === own || byName.has(name) || used.has(name)) continue;
    rows.push({ name, uses: false, status: 'unavailable', confirmed: true });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}
