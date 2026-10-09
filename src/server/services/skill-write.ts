/**
 * `update_skill_file` — the owner function of the M52 write operation (2.1.9,
 * sheet `katalog-operacji-m52` row 2, entity `spec-skill-tools-update-skill-file`).
 *
 * Writes ONE file of a skill package of the current project, addressed by
 * `(slug, file)`, through the facade of the project's `skills` root — the record
 * store of that root, never a direct disk write — so the write is labelled,
 * serialized per path and versioned exactly like a page saved from the editor.
 *
 * ## What it refuses, and with which code
 *
 *  - `slug` that is not one package directory name, `file` absolute or carrying
 *    `..` → `INVALID_ARGUMENT`;
 *  - both or neither of `content` / `textEdits` → `INVALID_ARGUMENT`;
 *  - `expectedHash` different from the hash of the file on disk — `""` against an
 *    existing file included, and a non-empty hash against a file that does not
 *    exist — → `PAGE_CONFLICT`, carrying the current hash;
 *  - a `SKILL.md` that, after the write, has no non-empty `description` in its
 *    frontmatter → `INVALID_ARGUMENT`; the file stays byte-identical;
 *  - `textEdits` that miss → `FIND_NOT_FOUND` / `MATCH_COUNT_MISMATCH` (the shared
 *    substitution engine).
 *
 * The `description` rule is the ONLY header check here. A SKILL.md whose header
 * fails another part of the registry's contract is written: the package becomes
 * invalid, stays editable, and drops out of the listing — M52 `q6jr8zoj`.
 *
 * The read-only refusal (`SKILL_READ_ONLY`) for a slug the registry resolves to
 * an exposed project belongs to the `project-exposed` source and is not built
 * here; {@link SkillWriteDeps.readOnlyReason} is the seam it plugs into.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import type { WriteActor } from '../fs/sources.js';
import { RecordConflictError } from '../fs/record-store.js';
import { ConflictError } from './brief.js';
import type { PagesService } from './pages.js';
import { sha256 } from './section-text.js';
import { DomainError } from './tags.js';
import { applyTextEdits, type TextEdit } from './text-edits.js';

/** The package's entry file — the default `file`. */
export const SKILL_ENTRY_FILE = 'SKILL.md';

export interface SkillWriteDeps {
  /**
   * The facade of this project's root of kind `skills`. `undefined` when the
   * project has none mounted (a hand-rolled rig) — the write then fails loudly.
   */
  skillsRoot: () => { pages: PagesService } | undefined;
  /**
   * Seam for the `project-exposed` source: a non-null answer refuses the slug as
   * read-only. Absent until that source exists.
   */
  readOnlyReason?: (slug: string) => string | null;
}

export interface UpdateSkillFileInput {
  slug: string;
  /** Package-relative POSIX path; defaults to {@link SKILL_ENTRY_FILE}. */
  file?: string;
  content?: string;
  textEdits?: TextEdit[];
  /** REQUIRED. `""` = create a file that must not exist yet. */
  expectedHash?: string;
}

/** Echo-free: the address and the new hash, never the file. */
export interface UpdateSkillFileResult {
  slug: string;
  file: string;
  /** Hash of the file after the write — the next write's `expectedHash`. */
  hash: string;
}

function invalid(message: string, hint?: string): DomainError {
  return new DomainError('INVALID_ARGUMENT', message, hint);
}

/** A package slug is one first-level directory name of the `skills` root. */
function assertSlug(slug: unknown): asserts slug is string {
  if (typeof slug !== 'string' || slug.length === 0) {
    throw invalid('slug is required', 'pass the package directory name, e.g. "release-notes"');
  }
  if (slug.includes('/') || slug.includes('\\') || slug === '.' || slug === '..' || slug.startsWith('.') || slug.includes('\0')) {
    throw invalid(
      `slug '${slug}' is not a package directory name`,
      'a slug is a single directory name of the skills root: no "/", no "\\\\", not starting with "."',
    );
  }
}

/** `file` is package-relative POSIX: no absolute path, no `..`. */
function normalizeFile(file: unknown): string {
  if (file === undefined) return SKILL_ENTRY_FILE;
  if (typeof file !== 'string' || file.length === 0) {
    throw invalid('file must be a non-empty package-relative path', `omit it to write ${SKILL_ENTRY_FILE}`);
  }
  const absolute = file.startsWith('/') || /^[A-Za-z]:/.test(file) || file.startsWith('\\');
  const segments = file.split('/');
  if (absolute || file.includes('\\') || file.includes('\0') || segments.some((s) => s === '..')) {
    throw invalid(
      `file '${file}' is not a package-relative POSIX path`,
      'no absolute path, no "..", "/" as the separator — e.g. "workflows/brief.md"',
    );
  }
  if (segments.some((s) => s.length === 0 || s === '.')) {
    throw invalid(`file '${file}' has an empty or "." segment`, 'e.g. "workflows/brief.md"');
  }
  return file;
}

/** The SKILL.md header rule this operation enforces: a non-empty `description`. */
function assertSkillDescription(text: string): void {
  let data: Record<string, unknown>;
  try {
    // An options object bypasses gray-matter's content cache: the cache stores
    // an entry before parsing, so a second bare `matter(text)` of YAML that does
    // not parse (e.g. after the registry scan read the same bytes) returns
    // `{ data: {} }` instead of throwing.
    data = (matter(text, {}).data ?? {}) as Record<string, unknown>;
  } catch (err) {
    throw invalid(
      `SKILL.md frontmatter does not parse: ${(err as Error).message}`,
      'SKILL.md must keep a non-empty `description` in its frontmatter',
    );
  }
  const description = data.description;
  if (typeof description !== 'string' || description.trim().length === 0) {
    throw invalid(
      'SKILL.md must keep a non-empty `description` in its frontmatter',
      'add `description: <one line saying when to use the skill>` to the frontmatter block',
    );
  }
}

async function readIfPresent(abs: string): Promise<string | null> {
  try {
    return await fs.readFile(abs, 'utf-8');
  } catch {
    return null;
  }
}

function conflict(message: string, currentHash: string, currentContent?: string, hint?: string): ConflictError {
  const err = new ConflictError('PAGE_CONFLICT', message, currentHash, currentContent);
  return hint ? Object.assign(err, { hint }) : err;
}

export async function updateSkillFile(
  deps: SkillWriteDeps,
  input: UpdateSkillFileInput,
  actor: WriteActor = 'agent',
): Promise<UpdateSkillFileResult> {
  assertSlug(input.slug);
  const slug = input.slug;
  const file = normalizeFile(input.file);

  const hasContent = typeof input.content === 'string';
  const hasEdits = input.textEdits !== undefined;
  if (hasContent && hasEdits) {
    throw invalid(
      'content and textEdits are mutually exclusive — exactly one describes the new file',
      'send `content` (the whole new file) or `textEdits` (literal substitutions)',
    );
  }
  if (!hasContent && !hasEdits) {
    throw invalid(
      'one of content or textEdits is required',
      'send `content` (the whole new file) or `textEdits` (literal substitutions)',
    );
  }
  if (typeof input.expectedHash !== 'string') {
    throw invalid(
      'expectedHash is required',
      'pass the `hash` load_skill_file returned for this file, or "" to create a file that must not exist yet',
    );
  }
  const expectedHash = input.expectedHash;

  const readOnly = deps.readOnlyReason?.(slug) ?? null;
  if (readOnly !== null) {
    throw new DomainError('SKILL_READ_ONLY', readOnly);
  }

  const root = deps.skillsRoot();
  if (!root) throw new DomainError('INTERNAL', 'this project has no `skills` root mounted');
  const records = root.pages.records;
  if (!records) {
    throw new DomainError('INTERNAL', 'the `skills` root has no record store — skill files are only written through it');
  }

  const relPath = `${slug}/${file}`;
  const current = await readIfPresent(path.join(root.pages.root, relPath));

  // The guard, before anything is computed: "" creates, anything else must match.
  if (expectedHash === '') {
    if (current !== null) {
      throw conflict(
        `${relPath} already exists`,
        sha256(current),
        current,
        'pass the current `hash` as expectedHash to overwrite it',
      );
    }
  } else if (current === null) {
    throw conflict(`${relPath} does not exist`, '', undefined, 'pass expectedHash "" to create it');
  } else if (sha256(current) !== expectedHash) {
    throw conflict('skill file changed since last read', sha256(current), current);
  }

  let next: string;
  if (hasContent) {
    next = input.content as string;
  } else {
    if (current === null) {
      throw invalid('textEdits need an existing file', 'create the file with `content` and expectedHash ""');
    }
    next = applyTextEdits(current, input.textEdits ?? []).text;
  }

  if (file === SKILL_ENTRY_FILE) assertSkillDescription(next);

  try {
    // `raw`: the bytes land as sent — the hash the caller gets back is the hash
    // load_skill_file serves next. The store re-checks `expectedHash` under its
    // path lock (an absent file passes; `""` against an existing one conflicts).
    const res = await records.write(relPath, { raw: next }, { actor, expectedHash });
    return { slug, file, hash: res.hash };
  } catch (err) {
    if (err instanceof RecordConflictError) {
      throw conflict('skill file changed since last read', err.currentHash, err.currentContent);
    }
    throw err;
  }
}
