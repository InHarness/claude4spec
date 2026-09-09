import type { WritingStyleContribution } from '@c4s/plugin-runtime';

import skillMd from './layered-vertical-slices/SKILL.md?raw';
import workflowBootstrap from './layered-vertical-slices/workflows/bootstrap.md?raw';
import workflowBrief from './layered-vertical-slices/workflows/brief.md?raw';
import workflowDaily from './layered-vertical-slices/workflows/daily.md?raw';
import workflowPatch from './layered-vertical-slices/workflows/patch.md?raw';
import templateIndex from './layered-vertical-slices/templates/index.md?raw';
import templateLayer from './layered-vertical-slices/templates/layer.md?raw';
import templateModule from './layered-vertical-slices/templates/module.md?raw';
import partPlacement from './layered-vertical-slices/parts/placement.md?raw';
import partAuthoring from './layered-vertical-slices/parts/authoring.md?raw';
import partReadingSweep from './layered-vertical-slices/parts/reading-sweep.md?raw';
import partReadingDeps from './layered-vertical-slices/parts/reading-deps.md?raw';

/**
 * Drop the leading YAML frontmatter block.
 *
 * `PluginSkillContribution.content` is the BODY of `SKILL.md`, not the file:
 * the metadata beside it (`title`, `description`, `version`, `language`) is
 * carried by the contribution's own fields, and the registry never parses a
 * contributed skill. The disk roots get this from gray-matter; a contribution
 * has no file to hand it, so the four lines below are the whole of it.
 *
 * Deliberately not a dependency: the envelope's only import is
 * `@c4s/plugin-runtime`, and keeping it that way is what makes extracting this
 * package to its own repo a `tsconfig` edit rather than a port.
 */
function body(raw: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(raw);
  return (match ? raw.slice(match[0].length) : raw).trimStart();
}

/**
 * ONE HOME IN SOURCE, N DELIVERIES FROM THIS MODULE.
 *
 * A rule is written once, in `parts/`, and spliced into every document that
 * needs it before its reader reaches the step that depends on it. The agent
 * loads nothing beyond what it loads today — a workflow arrives already
 * carrying the rules of its own steps — and the source keeps a single copy
 * of each, which is the norm the style preaches in rule 2 and its own package
 * used to break seven times over.
 *
 * `parts/*` are SOURCE, not addresses: they are absent from `files`, so no
 * `load_skill_file` reaches one on its own and there is no second answer to
 * "where does this rule live". Composition happens here, at import, with
 * static `?raw` imports and a string replace — no Vite transform, because the
 * runtime never reads markdown off the disk and three build pipelines (vite,
 * the envelope's vitest, the host's tests off the source manifest) would be
 * three chances at different bytes.
 *
 * Whitespace-neutral by construction: a marker sits on a line of its own and
 * is replaced by the part's trimmed text, so the blank lines the author put
 * around the marker are the blank lines around the splice.
 */
const PARTS: Readonly<Record<string, string>> = {
  'parts/placement.md': partPlacement,
  'parts/authoring.md': partAuthoring,
  'parts/reading-sweep.md': partReadingSweep,
  'parts/reading-deps.md': partReadingDeps,
};

/**
 * The one line the brief workflow borrows from the purpose sweep: the module
 * main-file pattern, read off the sweep's own call so the two cannot drift.
 * A brief thread has no `search_pages`, so it takes the pattern, not the call.
 */
function modulePathPattern(): string {
  const match = /^\s*pathInclude:\s*("(?:[^"\\]|\\.)*")/m.exec(partReadingSweep);
  if (!match) throw new Error('parts/reading-sweep.md no longer carries a `pathInclude:` line');
  // The line is a JS string literal (`\\2`, `\\.md`); the brief gets the regex
  // itself, not its source form — parsed, so what it reads is what the sweep runs.
  return JSON.parse(match[1]) as string;
}

/**
 * The check list: one source, two projections.
 *
 * Every rule that can be settled on the text alone carries a `*Symptom:*`
 * marker beside it in `parts/placement.md` and `parts/authoring.md`. This
 * reads those markers into a flat list — one line per symptom, prefixed by
 * the rule it belongs to — for the daily workflow's drift check and for the
 * `spec-review` subagent's prompt. Neither holds a second copy of a rule: a
 * symptom added or reworded in its part is in both projections at the next
 * load, and a rule without a marker is, correctly, absent from both.
 */
export function extractChecks(...parts: string[]): string[] {
  const checks: string[] = [];
  for (const part of parts) {
    let section = '';
    let rule = '';
    for (const line of part.split(/\r?\n/)) {
      const heading = /^##+ (.+)$/.exec(line);
      if (heading) {
        section = heading[1]!;
        rule = '';
        continue;
      }
      const item = /^\s*(\d+[a-z]?)\. \*\*(.+?)\*\*/.exec(line);
      if (item) {
        const inCel = /`Cel`/.test(section) || /section text alone/.test(section);
        const title = item[2]!.replace(/[.:]$/, '');
        rule = inCel ? `Cel ${item[1]} — ${title}` : `Rule ${item[1]} — ${title}`;
      }
      const marker = line.indexOf('*Symptom:*');
      // A marker outside any rule is prose ABOUT markers, not a check.
      if (marker === -1 || rule === '') continue;
      const sub = /^\s*- \*\*(.+?)\*\*/.exec(line);
      const symptom = line.slice(marker + '*Symptom:*'.length).trim();
      const label = sub ? `${rule} (${sub[1]!.replace(/[.:]$/, '')})` : rule;
      checks.push(`- **${label}.** ${symptom}`);
    }
  }
  return checks;
}

/** The check list as it is delivered — to `daily.md` step 5 and to `spec-review`. */
export const checksProjection: string = extractChecks(partPlacement, partAuthoring).join('\n');

/** Derived splices — text computed from a part rather than copied out of it. */
const DERIVED: Readonly<Record<string, () => string>> = {
  'module-path-pattern': () => `\`${modulePathPattern()}\``,
  checks: () => checksProjection,
};

const INCLUDE = /^[ \t]*<!--\s*include:\s*(\S+)\s*-->[ \t]*$/gm;

/** How many documents each include name was spliced into — for the tests. */
export const includeUsage: Record<string, number> = Object.fromEntries(
  [...Object.keys(PARTS), ...Object.keys(DERIVED)].map((name) => [name, 0]),
);

export function compose(doc: string): string {
  return doc.replace(INCLUDE, (_marker, name: string) => {
    const text = name in DERIVED ? DERIVED[name]!() : PARTS[name];
    if (text === undefined) throw new Error(`unknown include "${name}" in the layered-vertical-slices package`);
    includeUsage[name] = (includeUsage[name] ?? 0) + 1;
    return text.trim();
  });
}

/**
 * The reference writing style, moved out of the host's in-package skills root —
 * a root that 0.2.66 deleted outright, this having been the move that emptied it
 * of styles.
 *
 * It travels as literals rather than as files, and that is the ONE real cost
 * difference against the FS roots: those resolve a package lazily off the disk on
 * every read, this one sits in the registry's memory from registration onwards. In
 * exchange it is distributable — the whole point of the move.
 *
 * `scope` is absent because `contributes.writingStyles[]` is sugar for
 * `contributes.skills[]` with `scope: 'writing-style'`; the host lowers it.
 *
 * The metadata below is a verbatim copy of the frontmatter this package carried
 * in `src/server/skills/layered-vertical-slices/SKILL.md`. Keep the two in step:
 * the file's own frontmatter is now inert (the registry reads these fields, not
 * the file), but it is what an author reads first.
 */
export const layeredVerticalSlicesStyle: WritingStyleContribution = {
  slug: 'layered-vertical-slices',
  title: 'Layered Vertical Slices',
  description:
    'Conventions for layered, vertical-slice specifications — module/layer structure, file layout, and four workflows (bootstrap, daily, brief, patch) that carry the rules. TRIGGER when the active writing style is this slug — editing a spec page, drafting plans, creating modules or layers, answering structural questions.',
  /**
   * 2 since the reformat: the quality rules and the reading protocols left
   * `content` for the workflows, which is a change of what a reader of the
   * core can expect to find there.
   */
  version: 2,
  language: 'en',
  content: compose(body(skillMd)),
  /**
   * Keys are POSIX paths relative to the skill package — the same addresses
   * `load_skill_file(slug, file)` takes, and the same ones the directory used
   * on disk. A renamed key is a broken cross-reference in the prose, so the
   * shape of this map is part of the contribution, not an implementation
   * detail of it. `parts/*` are deliberately not keys — see `compose`.
   */
  files: {
    'workflows/bootstrap.md': compose(workflowBootstrap),
    'workflows/brief.md': compose(workflowBrief),
    'workflows/daily.md': compose(workflowDaily),
    'workflows/patch.md': compose(workflowPatch),
    'templates/index.md': compose(templateIndex),
    'templates/layer.md': compose(templateLayer),
    'templates/module.md': compose(templateModule),
  },
};
