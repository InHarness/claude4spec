/**
 * M52 — the `project-exposed` skill source (2.1.9, `ybbal0vf`, `9j9cxrsr`,
 * `gx7f584v`, `1v62dbhb`; registry contract M37 `zscui1qz`, carrier M37
 * `fgehgc8h`, read form M37 `7pj9yx9k`).
 *
 * A provider — a project of the workspace with `skill.exposed` on — is ONE skill
 * of the consumers that attach it by its `skill.name` (`skill.uses`). The slug is
 * that name (the source gives it, not a directory). Its entry content is the page
 * named by `skill.entry`, its subfiles are the pages of the provider's base root
 * addressed by their path in that root; the provider's other roots — its own
 * `skills` root included — are not part of the package in v1. `description`,
 * scope and context types come from the provider's exposure fields.
 *
 * The declaration (the registry only names this source, the values are M52's):
 *  - name and `source` value: `project-exposed`;
 *  - admitted scopes: `writing-style` and `contextual` (the author declares the
 *    reach in `skill.scope` / `skill.contextTypes`; the module adds no filter);
 *  - rank: the `project-exposed` rung of both chains;
 *  - writable: NO — a consumer has no right to write someone else's project;
 *    `update_skill_file` refuses such a slug with `SKILL_READ_ONLY`;
 *  - scan: live — the attachments and the providers' exposure are read on every
 *    registry query (the listing is still frozen per thread by its consumer);
 *  - file read: the provider's pages read NOW, in the provider's context,
 *    without frontmatter and anchor lines, expanded inline by the M19 core in
 *    that context (entity tags and section refs become text: the provider's
 *    slugs and anchors do not exist in the consumer). No `hash`. Nothing is
 *    copied or written anywhere;
 *  - manifest limit: {@link EXPOSED_SKILL_MANIFEST_LIMIT};
 *  - known, unresolved: every attachment that resolves to no provider —
 *    dangling or ambiguous — with the reason `provider-unreachable`.
 *
 * Attachments are not transitive (only the consumer's own `skill.uses` is read),
 * attaching oneself is ignored with a warning, and neither a dangling nor an
 * ambiguous attachment is an error: a warning, never a failed start.
 *
 * L10: one instance per consumer context, key `projectId`, released with it (GC).
 * It holds NO handle to a provider's context: it asks the layer's implementor for
 * one on every read, and that context's lifetime and eviction are the
 * implementor's (the M31 context cache).
 */

import { ANCHOR_LINE_RE } from '../../shared/anchor-pattern.js';
import type { ChatContextType } from '../../shared/entities.js';
import { expandEmbeds } from '../../core/references/expand-embeds.js';
import type { ExpansionContext } from '../../core/references/types.js';
import { DomainError } from './tags.js';
import { isKnownContextType } from './chat-context.js';
import { resolveAttachments, type ExposedProject } from './exposed-projects.js';
import {
  toPackageFiles,
  type SkillFileRead,
  type SkillMetadata,
  type SkillRung,
  type SkillScope,
  type SkillSourceRegistration,
  type SkillSourceScan,
  type UnresolvedSkillSlug,
} from './skill-registry.js';

export const PROJECT_EXPOSED_SOURCE = 'project-exposed' as const;

/**
 * The manifest limit this source declares (M37 `zscui1qz`): a provider's base root
 * can hold far more pages than a skill package; over the limit `files` is cut and
 * the answer carries `truncated` + `truncationHint`. A page left out stays
 * addressable as `(slug, file)`.
 */
export const EXPOSED_SKILL_MANIFEST_LIMIT = 200;

/** The skill package of a provider, as its own context reads it. */
export interface ExposedSkillPackage extends SkillFileRead {
  /** The base-root path of the entry page (`skill.entry`). */
  entry: string;
}

/** What the source needs from the M31 layer — never a handle it keeps. */
export interface ExposedSkillAccess {
  /** The consumer's `skill.uses`, read per query. */
  uses(): string[];
  /** Every project of the workspace exposed as a skill (M52 list over the M31 project list), read per query. */
  listExposed(): ExposedProject[];
  /** Read the provider's package in the provider's context — the context is obtained for this read only. */
  readProvider(projectId: string): Promise<ExposedSkillPackage>;
}

export class ProjectExposedSkillSource implements SkillSourceRegistration {
  readonly name = PROJECT_EXPOSED_SOURCE;
  readonly source = PROJECT_EXPOSED_SOURCE;
  readonly scopes: readonly SkillScope[] = ['writing-style', 'contextual'];
  readonly rank: Readonly<Partial<Record<SkillScope, SkillRung>>> = {
    'writing-style': 'project-exposed',
    contextual: 'project-exposed',
  };
  readonly writable = false;
  readonly scan = 'live' as const;
  readonly manifestLimit = EXPOSED_SKILL_MANIFEST_LIMIT;

  private warned = new Set<string>();

  constructor(
    /** The consumer's project id — the project whose registry this source feeds. */
    private readonly consumerId: string,
    private readonly access: ExposedSkillAccess,
  ) {}

  private warnOnce(message: string): void {
    if (this.warned.has(message)) return;
    this.warned.add(message);
    console.warn(message);
  }

  private resolutions() {
    let uses: string[] = [];
    let exposed: ExposedProject[] = [];
    try {
      uses = this.access.uses();
      exposed = this.access.listExposed();
    } catch (err) {
      this.warnOnce(`[skill] project-exposed: attachments unreadable: ${(err as Error).message}`);
    }
    return resolveAttachments(this.consumerId, uses, exposed);
  }

  list(): SkillSourceScan {
    const out: SkillSourceScan = { entries: [], skipped: [] };
    for (const r of this.resolutions()) {
      if (r.status === 'self') {
        this.warnOnce(`[skill] skill.uses "${r.name}" is this project's own skill name — attaching oneself is ignored`);
        continue;
      }
      if (r.status === 'unavailable') {
        this.warnOnce(`[skill] skill.uses "${r.name}": no project of the workspace exposes this name — the attachment is unavailable`);
        continue;
      }
      if (r.status === 'ambiguous') {
        this.warnOnce(
          `[skill] skill.uses "${r.name}": exposed by ${r.providers.length} projects (${r.providers.map((p) => p.projectId).join(', ')}) — the attachment is ambiguous and resolves to none`,
        );
        continue;
      }
      out.entries.push(metadataOf(r.provider));
    }
    return out;
  }

  async read(metadata: SkillMetadata): Promise<SkillFileRead> {
    const projectId = metadata.project;
    if (!projectId) throw new Error(`project-exposed: entry "${metadata.slug}" carries no provider id`);
    let pkg: ExposedSkillPackage;
    try {
      pkg = await this.access.readProvider(projectId);
    } catch (err) {
      if (err instanceof DomainError) throw err;
      // The provider vanished or its context cannot be built between the listing
      // and this read: the attachment is unreachable NOW.
      throw new DomainError(
        'SKILL_NOT_FOUND',
        `no skill "${metadata.slug}" in this project's registry — known but unresolved: the provider of this skill attachment is unreachable (${(err as Error).message})`,
        'the provider may have stopped exposing itself, been renamed or left the workspace',
      );
    }
    return { content: pkg.content, files: pkg.files };
  }

  unresolved(): UnresolvedSkillSlug[] {
    const out: UnresolvedSkillSlug[] = [];
    for (const r of this.resolutions()) {
      if (r.status === 'unavailable') {
        out.push({ slug: r.name, reason: 'provider-unreachable', detail: 'no project of the workspace exposes this name' });
      } else if (r.status === 'ambiguous') {
        out.push({
          slug: r.name,
          reason: 'provider-unreachable',
          detail: `the name is exposed by ${r.providers.length} projects, so it resolves to none`,
        });
      }
    }
    return out;
  }
}

/** The registry entry of one resolved attachment — metadata only, from the exposure fields. */
function metadataOf(p: ExposedProject): SkillMetadata {
  const contextTypes = p.contextTypes?.filter((t): t is ChatContextType => isKnownContextType(t));
  return {
    slug: p.name,
    title: p.name,
    description: p.description ?? '',
    version: 1,
    language: 'en',
    scope: p.scope,
    source: PROJECT_EXPOSED_SOURCE,
    ...(contextTypes !== undefined ? { contextTypes } : {}),
    path: '',
    project: p.projectId,
  };
}

/** What the provider side needs to read its own package. */
export interface ExposedPackageReader {
  /** Base-root-relative paths of every page of the base root. */
  listPages(): Promise<string[]>;
  readRaw(relPath: string): Promise<string>;
  /** The provider's base root id — the source of relative page links. */
  rootId: string;
  /** The PROVIDER's expansion context (M19). */
  expansion: ExpansionContext;
}

/**
 * Provider side: the package as the provider's own context reads it, NOW — the
 * entry page as `content`, every other page of the base root as a subfile, each
 * without frontmatter and anchor lines and expanded inline (like `c4s resolve`)
 * in the provider's context. Nothing is written.
 */
export async function readExposedPackage(reader: ExposedPackageReader, entry: string): Promise<ExposedSkillPackage> {
  const pages = await reader.listPages();
  if (!pages.includes(entry)) {
    throw new DomainError(
      'SKILL_NOT_FOUND',
      `the exposed project's entry page "${entry}" does not exist in its base root`,
      'the provider sets skill.entry to an existing page of its base root',
    );
  }
  const expanded = async (rel: string): Promise<string> => {
    const text = stripForSkill(await reader.readRaw(rel));
    const res = await expandEmbeds(text, reader.expansion, { format: 'inline', source: { rootId: reader.rootId, path: rel } });
    return res.text;
  };
  const content = await expanded(entry);
  const files: Record<string, string> = {};
  for (const rel of pages) {
    if (rel === entry) continue;
    files[rel] = await expanded(rel);
  }
  return { entry, content, files: toPackageFiles(files) };
}

/** A page without its frontmatter block and without anchor lines — the form a consumer reads. */
export function stripForSkill(raw: string): string {
  let body = raw;
  const fm = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(body);
  if (fm) body = body.slice(fm[0].length);
  return body
    .split('\n')
    .filter((line) => !ANCHOR_LINE_RE.test(line))
    .join('\n')
    .replace(/^\n+/, '');
}

/**
 * `update_skill_file`'s read-only rule (`SKILL_READ_ONLY`): a slug OUTSIDE this
 * project's `skills` root that the registry resolves to an exposed project (the
 * winner's source is `project-exposed`) is refused, pointing the agent at `ask`
 * on the provider — the exposed project changes only at the provider, by its
 * plan. A package directory of that slug in the project's own root is the
 * project's to write, whatever wins the chain. `null` for any other slug.
 */
export function exposedReadOnlyReason(
  winner: Pick<SkillMetadata, 'slug' | 'source' | 'project'> | undefined,
  ownPackageExists = false,
): string | null {
  if (ownPackageExists || !winner || winner.source !== PROJECT_EXPOSED_SOURCE) return null;
  const ask = winner.project ? `ask({ project: "${winner.project}" })` : 'ask on the provider';
  return `skill "${winner.slug}" comes from an exposed project and is read-only here — propose the change to its owner with ${ask}`;
}
