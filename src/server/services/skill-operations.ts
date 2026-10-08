/**
 * M37 core — the two operations of the skills registry, as plain functions.
 *
 * 0.2.99 moved these out of the `skill-tools` MCP handler. Until then the only
 * rendering of `load_skill_file` was the in-turn MCP server, so its semantics
 * could live in the handler; with four renderings (internal MCP, external MCP
 * `c4s-reader` surface, REST, `c4s`) that would be four copies. The catalog's
 * rule is one function per operation: every channel calls these and only builds
 * its own envelope around the result. Refusals are `DomainError`s with the SAME
 * code on every channel — a channel changes the envelope, never the taxonomy.
 *
 * Nothing here writes to disk, and no response shape carries a disk path: a
 * subfile's address is the pair `(slug, file)`.
 */

import { DomainError } from './tags.js';
import { DEFAULT_BUDGET_CHARS } from '../discovery/budget.js';
import { formatLegalContextTypes, isKnownContextType } from './chat-context.js';
import type {
  ContextSkills,
  InvalidSkillRead,
  SkillPackageFile,
  SkillRegistry,
  SkillResolver,
  SkillScope,
  SkillSource,
  SkillUnresolvedReason,
} from './skill-registry.js';

/** The default `file` — opening a skill and reading its body are one operation in two modes. */
export const DEFAULT_SKILL_FILE = 'SKILL.md';

/** `list_skills` — the resolver's set plus the active writing style, which is NOT a listing row. */
export type SkillListingResponse = ContextSkills;

/**
 * `load_skill_file` — two shapes of one structure: opening a package (manifest,
 * no `path`) or reading one subfile (`path`, no manifest). DTO
 * `skill-package-response` (2.1.9).
 */
export interface SkillPackageResponse {
  slug: string;
  /**
   * Opening: `SKILL.md` in the form the entry's source reads it (`user`/`plugin`:
   * body without frontmatter; `project-rooted`: the raw file). Subfile: that
   * file's text. Optional in the shared structure only because an invalid
   * `project-rooted` package without `SKILL.md` opens without it.
   */
  content?: string;
  /** Opening only. */
  title?: string;
  /** Opening only. */
  description?: string;
  /** Opening only. */
  scope?: SkillScope;
  /** Opening only, always there: the `source` of the entry that won the precedence chain. */
  source?: SkillSource;
  /** Opening only, and only when the winner's source returns one (a writable source). Never computed here. */
  hash?: string;
  /**
   * Opening only — every other file of the package, metrics only; cut to the
   * manifest limit when the winner's source declares one.
   */
  files?: Array<{ path: string; bytes: number; lines: number; isText: boolean }>;
  /** Subfile read only — POSIX, package-relative, never a disk path. */
  path?: string;
  /**
   * 2.1.9 (M37 `7pj9yx9k`): an invalid `project-rooted` package served under a
   * slug the registry does not resolve — on both shapes, opening and subfile.
   */
  invalid?: true;
  invalidReason?: string;
  /** Present (and `true`) only when something was cut: the content over the budget, or the manifest over the source's limit. */
  truncated?: true;
  truncationHint?: string;
}

/**
 * `list_skills(contextType?)`.
 *
 * Given → the resolver's set for that context type. Omitted → the whole registry
 * (the union over all four types), because access to a skill is not gated by
 * context. A value outside the M44 enumeration is refused with the legal values
 * spelled out: an empty listing is a TRUE answer for a legal value, so it cannot
 * also be the answer to a typo.
 *
 * Ordering and slug de-duplication belong to the resolver; channels pass the
 * result through untouched.
 */
export function listSkills(resolver: SkillResolver, contextType?: string): SkillListingResponse {
  if (contextType === undefined) return resolver.resolveAll();
  if (!isKnownContextType(contextType)) {
    throw new DomainError(
      'INVALID_ARGUMENT',
      `unknown contextType '${contextType}'; ${formatLegalContextTypes()}`,
      'omit contextType to list the whole registry',
    );
  }
  return resolver.resolveForContext(contextType);
}

/**
 * `load_skill_file(slug, file = "SKILL.md")`.
 *
 * Serves the WHOLE registry (the precedence winner), not a context-filtered subset:
 * a skill outside every context type's listing is still a skill this project has.
 * The listing is a suggestion of what is worth opening, not a permission boundary.
 */
export function loadSkillFile(registry: SkillRegistry, slug: string, file?: string): SkillPackageResponse {
  if (!registry.has(slug)) {
    // M37 `7pj9yx9k` / M52 `q6jr8zoj`: a slug no source resolves, under which an
    // invalid package lies, is SERVED — marked invalid, with its reason — rather
    // than refused. A resolvable slug never reaches this branch: it serves the
    // chain's winner, never a shadowed invalid file.
    const invalid = registry.resolveInvalid(slug);
    if (invalid) return loadInvalidPackage(invalid, file);
    // M37 `vsa4f54s`: a slug no source delivers is refused WITH its reason — the
    // registry's own (`outside-registry`) or the one a source reported.
    const unresolved = registry.unresolvedReason(slug) ?? { slug, reason: 'outside-registry' as const };
    const known = Array.from(new Set(registry.list().map((m) => m.slug)));
    throw new DomainError(
      'SKILL_NOT_FOUND',
      `no skill "${slug}" in this project's registry — ${describeUnresolved(unresolved.reason, unresolved.detail)}`,
      `closest slugs: ${nearestSlugs(slug, known).join(', ') || '(the registry is empty)'}`,
    );
  }
  // Resolution — and the disk read — happen HERE, in the server process.
  // The registry hands back the precedence winner, read by ITS source in the form
  // that source serves; the path it resolved does not enter the payload below.
  const resolved = registry.resolve(slug);
  const { metadata } = resolved;

  if (file === undefined) {
    // Metrics only — the manifest is what makes a subfile's cost visible before
    // it is paid, and `isText: false` announces a NOT_TEXT refusal in advance.
    const manifest = manifestOf(resolved.files);
    const limit = registry.manifestLimitOf(slug);
    const files = limit !== undefined && manifest.length > limit ? manifest.slice(0, limit) : manifest;
    const body = budgeted(resolved.content, slug, DEFAULT_SKILL_FILE);
    const hints = [
      ...(body.truncated ? [body.truncationHint!] : []),
      ...(files.length < manifest.length
        ? [
            `The manifest of skill "${slug}" lists ${files.length} of its ${manifest.length} package files — the limit its source declares. ` +
              'A file left out is still addressable as load_skill_file(slug, file).',
          ]
        : []),
    ];
    return {
      slug: metadata.slug,
      title: metadata.title,
      description: metadata.description,
      scope: metadata.scope,
      source: metadata.source,
      ...(resolved.hash !== undefined ? { hash: resolved.hash } : {}),
      content: body.content,
      files,
      ...(hints.length > 0 ? { truncated: true as const, truncationHint: hints.join(' ') } : {}),
    };
  }

  const normalized = normalizeFileArg(file);
  if (normalized === DEFAULT_SKILL_FILE) {
    // `SKILL.md` is not in `files` (it is `content`), so name it explicitly rather
    // than refusing the one path every caller can guess.
    return { slug: metadata.slug, path: normalized, ...budgeted(resolved.content, slug, normalized) };
  }

  const entry = readPackageFile(slug, resolved.files, normalized);
  return { slug: metadata.slug, path: normalized, ...budgeted(entry.content, slug, normalized) };
}

/**
 * An invalid package's answer: the same two shapes as a registry entry's, plus
 * `invalid: true` and `invalidReason`. No manifest limit (its source declares
 * none). A package without `SKILL.md` opens without `content`, and reading
 * `SKILL.md` from it is `SKILL_FILE_NOT_FOUND`.
 */
function loadInvalidPackage(invalid: InvalidSkillRead, file: string | undefined): SkillPackageResponse {
  const { slug } = invalid;
  const mark = { invalid: true as const, invalidReason: invalid.invalidReason };
  if (file === undefined) {
    const body = invalid.content !== undefined ? budgeted(invalid.content, slug, DEFAULT_SKILL_FILE) : undefined;
    return {
      slug,
      ...(invalid.title !== undefined ? { title: invalid.title } : {}),
      ...(invalid.description !== undefined ? { description: invalid.description } : {}),
      ...(invalid.scope !== undefined ? { scope: invalid.scope } : {}),
      source: invalid.source,
      ...(invalid.hash !== undefined ? { hash: invalid.hash } : {}),
      ...(body ? { content: body.content } : {}),
      files: manifestOf(invalid.files),
      ...mark,
      ...(body?.truncated ? { truncated: true as const, truncationHint: body.truncationHint! } : {}),
    };
  }
  const normalized = normalizeFileArg(file);
  if (normalized === DEFAULT_SKILL_FILE && invalid.content !== undefined) {
    return { slug, path: normalized, ...budgeted(invalid.content, slug, normalized), ...mark };
  }
  const entry = readPackageFile(slug, invalid.files, normalized);
  return { slug, path: normalized, ...budgeted(entry.content, slug, normalized), ...mark };
}

/** The manifest of a package: metrics only, sorted by path. */
function manifestOf(files: Record<string, SkillPackageFile>): Array<{ path: string; bytes: number; lines: number; isText: boolean }> {
  return Object.values(files)
    .map(({ path, bytes, lines, isText }) => ({ path, bytes, lines, isText }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** One subfile of a package, or the `SKILL_FILE_NOT_FOUND` / `NOT_TEXT` refusal. */
function readPackageFile(slug: string, files: Record<string, SkillPackageFile>, normalized: string): SkillPackageFile {
  // `hasOwn`, not truthiness: a plain object literal inherits
  // `constructor`/`toString`/`valueOf`, so `files['constructor']` would otherwise
  // hand back an inherited function and answer NOT_TEXT for a path the manifest
  // never listed.
  const entry = Object.hasOwn(files, normalized) ? files[normalized] : undefined;
  if (!entry) {
    const paths = Object.keys(files).sort();
    throw new DomainError(
      'SKILL_FILE_NOT_FOUND',
      `skill "${slug}" has no file "${normalized}"`,
      paths.length > 0
        ? `available paths: ${paths.join(', ')}`
        : `skill "${slug}" is a single SKILL.md with no package files`,
    );
  }
  if (!entry.isText) {
    throw new DomainError(
      'NOT_TEXT',
      `"${normalized}" is not a text file (${entry.bytes} bytes) — this channel serves text only`,
      'the manifest from load_skill_file(slug) marks it `isText: false`; pick a text file from that list',
    );
  }
  return entry;
}

/** The reason of a `SKILL_NOT_FOUND`, worded for the message (M37 `vsa4f54s`). */
function describeUnresolved(reason: SkillUnresolvedReason, detail?: string): string {
  switch (reason) {
    case 'envelope-not-loaded':
      return `known but unresolved: the plugin package contributing it did not load${detail ? ` (${detail})` : ''}`;
    case 'outside-registry':
      return 'outside the registry: no source of this project delivers it';
  }
}

/**
 * Slugs to name in a `SKILL_NOT_FOUND`, nearest first.
 *
 * Substring containment either way, then a shared-prefix fallback, then the whole
 * registry if neither matches — no edit-distance dependency, because the caller is
 * a model that mistypes by truncating or guessing a synonym far more often than by
 * transposing characters. The list is capped: a refusal is a repair instruction,
 * not a catalogue.
 */
function nearestSlugs(slug: string, all: readonly string[], limit = 5): string[] {
  const needle = slug.toLowerCase();
  const scored = all
    .map((candidate) => {
      const c = candidate.toLowerCase();
      if (c.includes(needle) || needle.includes(c)) return { candidate, rank: 0 };
      let shared = 0;
      while (shared < c.length && shared < needle.length && c[shared] === needle[shared]) shared += 1;
      return { candidate, rank: shared >= 3 ? 1 : 2 };
    })
    .sort((a, b) => a.rank - b.rank || a.candidate.localeCompare(b.candidate));
  const near = scored.filter((s) => s.rank < 2).map((s) => s.candidate);
  return (near.length > 0 ? near : scored.map((s) => s.candidate)).slice(0, limit);
}

/**
 * Reject anything that is not a POSIX-relative path inside the package.
 *
 * Runs BEFORE existence, and that order is contractual: a path that escapes the
 * package must answer `INVALID_ARGUMENT` (the shape is wrong, and will stay
 * wrong) rather than `SKILL_FILE_NOT_FOUND` (the shape is fine, this package just
 * has no such file). Conflating them would tell a caller probing `../../etc/passwd`
 * that the file merely is not there.
 *
 * Purely lexical, on purpose. The package is a map in memory, not a directory
 * being walked, so there is no symlink to follow and no `realpath` to consult —
 * the only escape available is one spelled out in the argument.
 */
function normalizeFileArg(raw: string): string {
  const bad = (why: string): never => {
    throw new DomainError(
      'INVALID_ARGUMENT',
      `file "${raw}" is not addressable: ${why}`,
      'pass a POSIX path relative to the skill package, e.g. "workflows/brief.md" — no leading "/", no "..", no drive letter',
    );
  };
  const file = raw.trim();
  if (file === '') bad('it is empty');
  if (file.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(file)) bad('it is absolute');
  if (file.includes('\\')) bad('it uses backslashes; package paths are POSIX');
  const segments = file.split('/');
  if (segments.some((s) => s === '..')) bad('it contains a ".." segment');
  // Normalize away the noise a caller can legitimately produce (`./x`, `a//b`)
  // without letting it normalize its way OUT — `..` is already refused above.
  const cleaned = segments.filter((s) => s !== '' && s !== '.').join('/');
  if (cleaned === '') bad('it resolves to the package directory itself, not a file');
  return cleaned;
}

/**
 * The response budget, applied to whichever piece of text is being served.
 *
 * `DEFAULT_BUDGET_CHARS` is the same 50 000 every other agent-facing response is
 * held to, is shared by all four channels, and is NOT configurable — neither per
 * channel nor per skill (a per-skill override would let one package decide how
 * much of a turn's context it is entitled to).
 *
 * Truncation is never silent: `truncated` plus a hint that repeats the address,
 * because the address does not change. There is no ranged read to point at, so
 * the hint says what the caller can actually do.
 */
function budgeted(
  content: string,
  slug: string,
  file: string,
): { content: string; truncated?: true; truncationHint?: string } {
  if (content.length <= DEFAULT_BUDGET_CHARS) return { content };
  return {
    content: content.slice(0, DEFAULT_BUDGET_CHARS),
    truncated: true,
    truncationHint:
      `"${file}" of skill "${slug}" is ${content.length} chars; the first ${DEFAULT_BUDGET_CHARS} are above. ` +
      'The address (slug, file) is unchanged — this operation has no ranged read, so treat the rest as unavailable through this channel and work from what you have.',
  };
}
