/**
 * `fork_writing_style` — the owner function of the M52 style fork (2.1.9, sheet
 * `katalog-operacji-m52` row 3, lifecycle step 4 of M52 `gx7f584v`; 2.1.17).
 *
 * Copies the package of a writing style that comes from a PLUGIN — any such
 * style, named by its slug, not only the active one — into a package of the
 * same slug in the project's `skills` root. The slug is never compared with
 * `config.writingStyle`: copying an inactive style switches nothing in the
 * project, and that the card copies the active style is the card's business
 * (it sends only that slug). The copy is `SKILL.md` (the contribution's
 * metadata as the frontmatter, its body as the content) and every package file.
 * The copy's origin is recorded ONLY by the `forkedFrom` field of its `SKILL.md`
 * frontmatter; `config.writingStyle` is not touched — the local package outranks
 * the plugin one in the `writing-style` chain (`project-rooted` above `plugin`,
 * M37 `aw9kcadc`), so the active style now resolves to the copy by precedence,
 * not by a changed choice. In v1 only writing styles are forked.
 *
 * Every file goes through the record store of the `skills` root's facade (the
 * same path as `update_skill_file`), so the write is labelled, versioned and
 * reaches the UI as a file change (`ui-notify`). The package files are written
 * first and `SKILL.md` last: a package exists from the moment its `SKILL.md` is
 * written (M52 `gx7f584v` step 1).
 *
 * ## Refusals
 *
 *  - `slug` missing or not one package directory name → `INVALID_ARGUMENT`;
 *  - a package directory of that slug already in the `skills` root →
 *    `SKILL_ALREADY_EXISTS` (a refusal, never an overwrite — the row's guard);
 *  - no writing style of that slug in the registry → `SKILL_NOT_FOUND`;
 *  - the style's winning entry does not come from a plugin → `INVALID_ARGUMENT`.
 *
 * Not idempotent: the second call meets the package the first one created.
 */

import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import type { ForkWritingStyleResponse } from '../../shared/spec-skills.js';
import type { PagesService } from './pages.js';
import { SUPPORTED_SKILL_VERSION, type SkillMetadata, type ResolvedSkill } from './skill-registry.js';
import { SKILL_ENTRY_FILE } from './skill-write.js';
import { DomainError } from './tags.js';

export interface ForkWritingStyleDeps {
  /** The project's skill registry (all sources) — who wins `slug`, and its package. */
  registry: {
    winnerOf(slug: string): SkillMetadata | undefined;
    resolve(slug: string): ResolvedSkill;
  };
  /** The facade of this project's root of kind `skills`; `undefined` when none is mounted. */
  skillsRoot: () => { pages: PagesService } | undefined;
}

/**
 * The `forkedFrom` value (M52 `gx7f584v`, 2.1.17): `plugin:<slug>@<version>` —
 * the source the style was copied from, its slug, and its `version` in the plugin
 * at the moment of the copy. No plugin package name: a registry entry does not
 * know which envelope brought it.
 */
export function forkedFromValue(meta: SkillMetadata): string {
  return `plugin:${meta.slug}@${meta.version}`;
}

function invalid(message: string, hint?: string): DomainError {
  return new DomainError('INVALID_ARGUMENT', message, hint);
}

function assertSlug(slug: unknown): asserts slug is string {
  if (typeof slug !== 'string' || slug.length === 0) {
    throw invalid('slug is required', 'pass the slug of a writing style that comes from a plugin');
  }
  if (slug.includes('/') || slug.includes('\\') || slug.startsWith('.') || slug.includes('\0')) {
    throw invalid(`slug '${slug}' is not a package directory name`);
  }
}

/**
 * `SKILL.md` of the copy: the contribution's metadata as frontmatter + its body.
 *
 * The copy's `version` is the smaller of the plugin style's version and
 * {@link SUPPORTED_SKILL_VERSION} (M52 `gx7f584v`, 2.1.17); `forkedFrom` keeps the
 * plugin's own. The `project-rooted` source skips a package above the supported
 * version and the `plugin` source does not check it (the reference style carries
 * a higher one), so a literal copy would be an invalid package and the plugin
 * style would keep winning its slug.
 */
export function forkedSkillMd(meta: SkillMetadata, body: string): string {
  const data = {
    title: meta.title,
    description: meta.description,
    version: Math.min(meta.version, SUPPORTED_SKILL_VERSION),
    language: meta.language,
    scope: 'writing-style',
    forkedFrom: forkedFromValue(meta),
  };
  return matter.stringify(body.endsWith('\n') ? body : `${body}\n`, data);
}

export async function forkWritingStyle(
  deps: ForkWritingStyleDeps,
  input: { slug?: unknown },
): Promise<ForkWritingStyleResponse> {
  assertSlug(input.slug);
  const slug = input.slug;

  const root = deps.skillsRoot();
  if (!root) throw new DomainError('INTERNAL', 'this project has no `skills` root mounted');
  const records = root.pages.records;
  if (!records) {
    throw new DomainError('INTERNAL', 'the `skills` root has no record store — skill files are only written through it');
  }

  // The guard: an existing package of this slug — valid or not — is a refusal.
  if (fs.existsSync(path.join(root.pages.root, slug))) {
    throw new DomainError(
      'SKILL_ALREADY_EXISTS',
      `a skill package "${slug}" already exists in this project's skills root`,
    );
  }

  // Any writing style from a plugin — no comparison with `config.writingStyle`.
  const winner = deps.registry.winnerOf(slug);
  if (!winner || winner.scope !== 'writing-style') {
    throw new DomainError('SKILL_NOT_FOUND', `no writing style "${slug}" in the skill registry`);
  }
  if (winner.source !== 'plugin') {
    throw invalid(
      `writing style "${slug}" does not come from a plugin (source: ${winner.source})`,
      'only a writing style contributed by a plugin is forked',
    );
  }

  const style = deps.registry.resolve(slug);
  for (const file of Object.values(style.files)) {
    if (!file.isText) continue;
    await records.write(`${slug}/${file.path}`, { raw: file.content }, { actor: 'user', expectedHash: '' });
  }
  const entry = `${slug}/${SKILL_ENTRY_FILE}`;
  await records.write(entry, { raw: forkedSkillMd(winner, style.content) }, { actor: 'user', expectedHash: '' });

  return { slug, path: entry };
}
