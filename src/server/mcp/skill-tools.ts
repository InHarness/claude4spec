/**
 * `skill-tools` — the ONLY channel through which a skill's content reaches the
 * model. One operation, `load_skill_file`, read-only and idempotent.
 *
 * ## Why this server exists
 *
 * Until 0.2.36 a skill was DELIVERED: the resolver loaded the whole package, the
 * turn handed it to `adapter.execute({ skills })`, the library materialized it in
 * a tmpdir, and the model opened it with the native `Skill(<slug>)` tool —
 * reaching subfiles with `Read`, because they were files on a disk.
 *
 * That made the channel a function of the sandbox. A `brief` thread runs with the
 * FS built-ins off, so a writing style pointing at `workflows/brief.md` — the sole
 * home of genre methodology since 0.2.19 — could not open the one file it was
 * telling the model to read. The package existed, on a path the model was not
 * allowed to touch.
 *
 * An MCP payload has no path. This server serves the SAME bytes in every context
 * type, with FS built-ins on or off, and nothing from the M37 registry is written
 * to disk at any point in a turn.
 *
 * ## A subfile has an address, not a path
 *
 * Every package file except `SKILL.md` is addressed by the pair `(slug, file)`,
 * relative to the package dir. The DISK PATH IS NOT PART OF THE CONTRACT and
 * never enters a payload — a style referring to `~/.claude/skills/foo/x.md` is
 * broken, and gets `INVALID_ARGUMENT` rather than a silent success that would
 * only work on the authoring machine.
 *
 * ## Outside the L3 operation catalog, deliberately
 *
 * There is no `CATALOG.register` row for `load_skill_file`, and its absence is a
 * decision rather than an omission: the catalog's subject is SPECIFICATION
 * content, and this operation's subject is a prompt asset. `profile-gate.ts`
 * passes an undeclared tool on a HOST-OWNED server through for every profile,
 * which is exactly the reach this needs — the writing style attaches to all four
 * context types, so its read channel cannot be gated by any of them.
 *
 * ## Deliberately not built (all addable later, additively)
 *
 * `list_skills` (the prompt's `<available_skills>` block carries the listing, and
 * `SKILL_NOT_FOUND` carries slug suggestions), `search_skill_files`, a batch
 * `paths[]`, and ranged reads.
 */

import { createMcpServer, mcpTool, z, type CapturedMcpServer } from '../plugin-runtime/index.js';
import { toolFailure, toolSuccess } from '../operations/envelope.js';
import { DomainError } from '../services/tags.js';
import { DEFAULT_BUDGET_CHARS } from '../discovery/budget.js';
import type { SkillRegistry } from '../services/skill-registry.js';

/** The default `file` — opening a skill and reading its body are one operation in two modes. */
export const DEFAULT_SKILL_FILE = 'SKILL.md';

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

export function buildSkillToolsServer(registry: SkillRegistry): CapturedMcpServer {
  const loadSkillFile = mcpTool(
    'load_skill_file',
    [
      'Load a skill from this project\'s skill registry — the ONLY way to read one.',
      'Two modes, one operation:',
      '- `slug` alone OPENS the skill: returns its title, description, scope, the body of SKILL.md, and `files` — a manifest of every other file in its package as { path, bytes, lines, isText }. Read the manifest before fetching a subfile; it tells you what the subfile costs.',
      '- `slug` + `file` READS one package subfile, e.g. load_skill_file("my-style", "workflows/brief.md"). `file` is a POSIX path relative to the package (never absolute, never with ".."); the disk location of a skill is not part of this contract and you never need it.',
      'Read-only and idempotent — this operation never writes.',
      'Content over the response budget comes back with `truncated: true` and a `truncationHint`; the address (slug, file) is unchanged.',
      'Works against the LIVE registry, so a skill added or edited after this thread started is readable immediately, even though the <available_skills> listing in your prompt was frozen on the first turn.',
    ].join('\n'),
    {
      slug: z.string().describe('Skill slug, from the <available_skills> listing in your system prompt.'),
      file: z
        .string()
        .optional()
        .describe(
          `Package-relative POSIX path of a subfile, from the \`files\` manifest. Defaults to "${DEFAULT_SKILL_FILE}" (the skill body).`,
        ),
    },
    async (args) => {
      try {
        const slug = String(args.slug ?? '');
        /**
         * The WHOLE registry, not `resolveForContext`'s subset.
         *
         * A skill outside this context type's attach list is still a skill this
         * project has, and a style is free to point at one. Narrowing the reader
         * to the listing would make the listing a permission boundary, which it is
         * not — it is a suggestion of what is worth opening.
         */
        const known = registry.list();
        if (!known.some((m) => m.slug === slug)) {
          throw new DomainError(
            'SKILL_NOT_FOUND',
            `no skill "${slug}" in this project's registry`,
            `closest slugs: ${nearestSlugs(slug, known.map((m) => m.slug)).join(', ') || '(the registry is empty)'}`,
          );
        }
        // Resolution — and the disk read — happen HERE, in the server process.
        // Precedence (project > global > plugin > bundled) is applied by the
        // registry; the path it resolved does not enter the payload below.
        const resolved = registry.resolve(slug);
        const { metadata } = resolved;

        if (args.file === undefined) {
          return toolSuccess(
            {
              slug: metadata.slug,
              title: metadata.title,
              description: metadata.description,
              scope: metadata.scope,
              ...budgeted(resolved.content, slug, DEFAULT_SKILL_FILE),
              // Metrics only — the manifest is what makes a subfile's cost visible
              // before it is paid, and it is the only complete view of the package
              // layout besides the `SKILL_FILE_NOT_FOUND` refusal.
              files: Object.values(resolved.files)
                .map(({ path, bytes, lines, isText }) => ({ path, bytes, lines, isText }))
                .sort((a, b) => a.path.localeCompare(b.path)),
            },
            { operation: 'load_skill_file', channel: 'mcp' },
          );
        }

        const file = normalizeFileArg(String(args.file));
        if (file === DEFAULT_SKILL_FILE) {
          // `SKILL.md` is not in `files` (it is `content`), so name it explicitly
          // rather than refusing the one path every caller can guess.
          return toolSuccess(
            { slug: metadata.slug, path: file, ...budgeted(resolved.content, slug, file) },
            { operation: 'load_skill_file', channel: 'mcp' },
          );
        }

        // `hasOwn`, not truthiness: a plain object literal inherits
        // `constructor`/`toString`/`valueOf`, so `files['constructor']` would
        // otherwise hand back an inherited function and answer NOT_TEXT for a
        // path the manifest never listed.
        const entry = Object.hasOwn(resolved.files, file) ? resolved.files[file] : undefined;
        if (!entry) {
          const paths = Object.keys(resolved.files).sort();
          throw new DomainError(
            'SKILL_FILE_NOT_FOUND',
            `skill "${slug}" has no file "${file}"`,
            paths.length > 0
              ? `available paths: ${paths.join(', ')}`
              : `skill "${slug}" is a single SKILL.md with no package files`,
          );
        }
        if (!entry.isText) {
          throw new DomainError(
            'NOT_TEXT',
            `"${file}" is not a text file (${entry.bytes} bytes) — this channel serves text only`,
            'the manifest from load_skill_file(slug) marks it `isText: false`; pick a text file from that list',
          );
        }

        return toolSuccess(
          { slug: metadata.slug, path: file, ...budgeted(entry.content, slug, file) },
          { operation: 'load_skill_file', channel: 'mcp' },
        );
      } catch (err) {
        return toolFailure(err);
      }
    },
  );

  return createMcpServer({ name: 'skill-tools', tools: [loadSkillFile] });
}

/**
 * The response budget, applied to whichever piece of text is being served.
 *
 * `DEFAULT_BUDGET_CHARS` is the same 120 000 every other agent-facing response is
 * held to, and is NOT configurable here — a per-skill override would let one
 * package decide how much of a turn's context it is entitled to.
 *
 * Truncation is never silent: `truncated` plus a hint that repeats the address,
 * because the address does not change. There is no ranged read to point at, so
 * the hint says what the caller can actually do — go to the file's own source, or
 * ask the skill's author to split it.
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
