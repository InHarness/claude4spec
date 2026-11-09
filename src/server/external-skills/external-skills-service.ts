import fs from 'node:fs';
import path from 'node:path';
import type { ProjectRecord } from '../workspace/types.js';
import { effectivePublicUrl, type WorkspaceNetwork } from '../../core/workspace/network.js';
import type { ExternalSkillContext, ExternalSkillSummary, FileSet, SkillSlug } from './types.js';
import { hostProjectTypeRegistry } from '../project-types/registry.js';
import { projectCapabilitySet } from '../project-types/capabilities.js';
import { DEFAULT_PROJECT_TYPE } from '../config.js';
import {
  SPEC_READER_FRONTMATTER,
  SPEC_READER_FRONTMATTER_NO_ENTITIES,
  specReaderBody,
} from './spec-reader-template.js';
import {
  BRIEF_IMPLEMENTER_FRONTMATTER,
  briefImplementerBody,
} from './brief-implementer-template.js';
import {
  refactorFrontmatter,
  refactorBody,
} from './refactor-template.js';

export type { ExternalSkillContext, ExternalSkillSummary, FileSet, SkillSlug } from './types.js';

/**
 * 0.1.103 M22 — assembles the injected identity the renderers below bake into
 * each generated SKILL.md. 2.1.0: `{ id, workspace, publicUrl }` — the registry
 * id and the workspace's effective `publicUrl` (never a directory, never a
 * request header). `publicUrl` overrides it when the address is already known
 * (`c4s install-skills --server <url>`).
 */
/** The capability set of a Specification (`spec`) — the full skill set and texts. */
export const SPEC_CAPABILITIES: ReadonlySet<string> = projectCapabilitySet(['entities', 'briefs', 'multi-root']);

export function buildExternalSkillContext(
  project: Pick<ProjectRecord, 'id'>,
  workspace: WorkspaceNetwork & { name: string },
  publicUrl?: string,
  /** 2.1.77 (M22 `m22dserv`): the project's capability set; absent = a Specification's. */
  capabilities: ReadonlySet<string> = SPEC_CAPABILITIES,
): ExternalSkillContext {
  return {
    id: project.id,
    workspace: workspace.name,
    publicUrl: (publicUrl ?? effectivePublicUrl(workspace)).replace(/\/+$/, ''),
    capabilities,
  };
}

/**
 * 2.1.77 (M22 `8tvwx2ry`): the capability set of a project TYPE, read from the
 * host's type registry — for a consumer that has the type's slug but no live
 * context (`c4s install-skills`). Absent slug = `spec`; a slug the registry does
 * not know = `null`.
 */
export function capabilitiesOfProjectType(slug: string | undefined): ReadonlySet<string> | null {
  const entry = hostProjectTypeRegistry().get(slug ?? DEFAULT_PROJECT_TYPE);
  return entry ? projectCapabilitySet(entry.capabilities) : null;
}

export function renderSpecReaderSkill(ctx: ExternalSkillContext): string {
  // 2.1.77 (M22 `8tvwx2ry`): the frontmatter follows `entities` too.
  const frontmatter = ctx.capabilities.has('entities') ? SPEC_READER_FRONTMATTER : SPEC_READER_FRONTMATTER_NO_ENTITIES;
  return frontmatter + '\n' + specReaderBody(ctx);
}

export function renderBriefImplementerSkill(ctx: ExternalSkillContext): string {
  return BRIEF_IMPLEMENTER_FRONTMATTER + '\n' + briefImplementerBody(ctx);
}

export function renderRefactorSkill(ctx: ExternalSkillContext): string {
  return refactorFrontmatter(ctx) + '\n' + refactorBody(ctx);
}

interface SkillMeta {
  slug: SkillSlug;
  dirName: string;
  name: string;
  description: string;
  render: (ctx: ExternalSkillContext) => string;
  /** 2.1.77 (M22 `8tvwx2ry`): capabilities the project must have for the skill to exist. */
  requires: readonly string[];
}

// 0.1.104 M22 — short, UI-facing descriptions (distinct from each SKILL.md's
// own long frontmatter `description:`, which is written for Claude's own
// skill-discovery, not for a Settings-page card).
const SKILL_META: SkillMeta[] = [
  {
    slug: 'spec-reader',
    dirName: 'c4s-spec-reader',
    name: 'c4s-spec-reader',
    description: 'Read spec entities (XML tags, c4s CLI/MCP) from a foreign code repo.',
    render: renderSpecReaderSkill,
    requires: [],
  },
  {
    slug: 'brief-implementer',
    dirName: 'c4s-brief-implementer',
    name: 'c4s-brief-implementer',
    description: 'Implement M21 briefs in a code repo with a patches feedback loop.',
    render: renderBriefImplementerSkill,
    requires: ['briefs'],
  },
  {
    slug: 'refactor',
    dirName: 'c4s-refactor',
    name: 'c4s-refactor',
    description: 'Drift-router spec↔code for a given topic (hard dependency on c4s + running server).',
    render: renderRefactorSkill,
    requires: [],
  },
];

export const ALL_SKILL_SLUGS: SkillSlug[] = SKILL_META.map((m) => m.slug);

export function isSkillSlug(x: string): x is SkillSlug {
  return (ALL_SKILL_SLUGS as string[]).includes(x);
}

const availableMeta = (capabilities: ReadonlySet<string>) =>
  SKILL_META.filter((m) => m.requires.every((c) => capabilities.has(c)));

/**
 * 2.1.77 (M22 `8tvwx2ry`): the skill slugs of a project with these capabilities —
 * three with `briefs`, two (`spec-reader`, `refactor`) without. A slug outside
 * this list is, for a selection (`--skills`, `?skills=`), an unknown slug.
 */
export function skillSlugsFor(capabilities: ReadonlySet<string>): SkillSlug[] {
  return availableMeta(capabilities).map((m) => m.slug);
}

/** Metadata for `GET /api/external-skills` — no SKILL.md content; the project's skills only. */
export function externalSkillsMetadata(capabilities: ReadonlySet<string>): ExternalSkillSummary[] {
  return availableMeta(capabilities).map(({ slug, name, description }) => ({ slug, name, description }));
}

/**
 * 0.1.104 M22 — pure content builder shared by `c4s install-skills` (CLI,
 * writes to disk) and `GET /api/external-skills/bundle` (HTTP, packs into a
 * ZIP in memory). No disk writes, no side effects — replaces the old
 * `ensureExternalSkills` bootstrap hook, which wrote unconditionally into
 * `.claude4spec/skills/` on every project activation/config change.
 */
export function buildExternalSkillsBundle(ctx: ExternalSkillContext, selection?: SkillSlug[]): FileSet {
  const wanted = selection && selection.length > 0 ? new Set(selection) : new Set(ALL_SKILL_SLUGS);
  const files: FileSet = new Map();
  // 2.1.77 (M22 `8tvwx2ry`): a skill the project's capabilities exclude is never rendered.
  for (const meta of availableMeta(ctx.capabilities)) {
    if (!wanted.has(meta.slug)) continue;
    files.set(`${meta.dirName}/SKILL.md`, meta.render(ctx));
  }
  return files;
}

/**
 * Writes a `FileSet` to disk under `targetDir`, overwriting unconditionally
 * (no hash-diff, no managed-zone markers — `c4s install-skills` is a one-shot
 * on-demand export, not a bootstrap-time sync). Creates `targetDir` lazily.
 * Returns the absolute paths written.
 */
export function writeFileSet(targetDir: string, files: FileSet): string[] {
  const written: string[] = [];
  for (const [relPath, content] of files) {
    const abs = path.join(targetDir, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
    written.push(abs);
  }
  return written;
}
