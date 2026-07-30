/**
 * M39's structural claims, as falsifiable tests.
 *
 * The brief states four rules that are easy to say and easy to erode: the core
 * is the only caller of the serialization registry, it is read-only from a hard
 * boundary, it addresses pages only as `(rootId, relPath)`, and it has no
 * address at all for briefs, patches, plans or the entity catalogue. Each of
 * those is a claim about code that does NOT exist, and a claim like that rots
 * silently unless something fails a build over it.
 *
 * Style follows `single-abstraction.test.ts` deliberately: comment-stripped
 * source greps with an explicit, commented allow-list, so an intentional
 * exception has to be argued for in the diff rather than slipped in.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.join(import.meta.dirname, '../../..');
const SRC = path.join(REPO_ROOT, 'src');
const CORE = path.join(SRC, 'server/discovery');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (/\.tsx?$/.test(entry.name)) out.push(abs);
    }
  };
  walk(dir);
  return out;
}

/** Comments are stripped: every rule below is discussed in prose that quotes it. */
function codeLines(file: string): Array<{ line: number; text: string }> {
  const out: Array<{ line: number; text: string }> = [];
  let inBlock = false;
  fs.readFileSync(file, 'utf-8')
    .split('\n')
    .forEach((text, i) => {
      const trimmed = text.trim();
      if (inBlock) {
        if (trimmed.includes('*/')) inBlock = false;
        return;
      }
      if (trimmed.startsWith('/*')) {
        if (!trimmed.includes('*/')) inBlock = true;
        return;
      }
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
      out.push({ line: i + 1, text });
    });
  return out;
}

function hits(files: string[], pattern: RegExp): string[] {
  const found: string[] = [];
  for (const file of files) {
    for (const { line, text } of codeLines(file)) {
      if (pattern.test(text)) found.push(`${path.relative(REPO_ROOT, file)}:${line}: ${text.trim()}`);
    }
  }
  return found;
}

const isProduction = (file: string) => !/\.test\.tsx?$/.test(file) && !file.includes('__fixtures__');

describe('M39 — Discovery Core', () => {
  it('the serialization registry is invoked only from the core', () => {
    const outside = sourceFiles(SRC).filter(
      (f) =>
        isProduction(f) &&
        !f.startsWith(CORE) &&
        // The engine IS the registry — it defines these, it does not consume them.
        !f.endsWith('core/plugin-host/serialization-engine.ts'),
    );
    expect(hits(outside, /\.serialize(Entity|Section)\(|\.serializer\.schema/)).toEqual([]);
  });

  it('the core never writes', () => {
    // Read-only from a HARD boundary, not by policy: an external agent finds no
    // write tool because there is no path to one, and a `readonly: true` handle
    // would turn any slip here into a runtime error rather than a data loss.
    // Tests are exempt — a fixture builds the database it then reads.
    const files = sourceFiles(CORE).filter(isProduction);
    expect(hits(files, /\b(INSERT|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/i)).toEqual([]);
    expect(hits(files, /\bnew Database\(/)).toEqual([]);
    expect(hits(files, /\bfs\.(write|append|unlink|rm|mkdir)/)).toEqual([]);
  });

  it('the core has no default page root and no branch on one', () => {
    // `resolve_page({ path })` answered from the built-in root whenever the
    // caller did not name one, which is a confidently wrong answer rather than
    // an error. A page position is `(rootId, relPath)`; there is no fallback.
    const files = sourceFiles(CORE).filter(isProduction);
    expect(hits(files, /rootId\s*[=:]\s*['"]pages['"]/)).toEqual([]);
    expect(hits(files, /rootId\s*===\s*['"]pages['"]|dir\s*===\s*['"]pages['"]/)).toEqual([]);
    expect(hits(files, /\?\?\s*['"]pages['"]/)).toEqual([]);
  });

  it('the core has no address for briefs, patches, plans or the entity catalogue', () => {
    // A barrier by CONSTRUCTION, not a rule in a prompt: the core only ever
    // sees `config.roots[]`, and those directories are artifact mounts rather
    // than page roots, so no parameter of any operation can name one.
    expect(hits(sourceFiles(CORE).filter(isProduction), /briefsDir|patchesDir|plansDir|entitiesDir/)).toEqual([]);
  });

  /**
   * 0.2.3 — the transports' half of the same idea. The core owning behaviour is
   * only worth anything if the surfaces actually reach it, and "reaches it" is a
   * claim about a tool LIST, which drifts silently: a tool quietly kept from the
   * old set keeps answering with the old semantics, and nothing fails.
   */
  describe('transports', () => {
    const READER = path.join(SRC, 'server/mcp/c4s-reader.ts');
    const readerSource = () => fs.readFileSync(READER, 'utf-8');
    /**
     * Tool names as DECLARED. `c4s-reader` wraps `mcpTool` in one `op(...)`
     * helper — every tool there is the same three lines, which is the point —
     * so both spellings are matched. A name matched from only one of them would
     * make these assertions quietly vacuous.
     */
    const toolNames = (file: string): string[] =>
      Array.from(fs.readFileSync(file, 'utf-8').matchAll(/\b(?:mcpTool|op)\(\s*\n?\s*'([a-z_]+)'/g)).map((m) => m[1]!);

    it('c4s-reader exposes exactly the fourteen core operations, by their own names', () => {
      // Read from the handler declarations, not from the exported name list —
      // otherwise the test would only prove the list agrees with itself.
      const declared = Array.from(readerSource().matchAll(/\bop\(\s*\n?\s*'([a-z_]+)'/g)).map((m) => m[1]!);
      const expected = [
        'overview',
        'describe_types',
        'list_pages',
        'list_sections',
        'get_section',
        'get_page',
        'search_pages',
        'search_entities',
        'list_entities',
        'get_entities',
        'list_tags',
        'find_references',
        'check_consistency',
        'resolve_identity',
      ];
      expect(declared.sort()).toEqual([...expected].sort());
    });

    it('the nine tools that 0.2.3 replaced are gone from c4s-reader', () => {
      // Not a subset relationship: each of these fronted an operation that was
      // renamed or absorbed, and `resolve_page` fronted one that was withdrawn.
      // Leaving any of them behind would ship two answers to the same question.
      const source = readerSource();
      for (const gone of ['get_entity', 'find_by_tag', 'resolve_page', 'catalog', 'describe', 'list_slugs']) {
        expect(source, `c4s-reader still declares '${gone}'`).not.toMatch(
          new RegExp(`mcpTool\\(\\s*\\n?\\s*'${gone}'`),
        );
      }
    });

    it('no tool on c4s-reader can mutate', () => {
      // The read-only guarantee an external agent relies on is structural: the
      // core exposes no write, so there is no path to one from this process.
      // A mutating NAME here would mean someone had found another path.
      const names = toolNames(READER);
      expect(names).toHaveLength(14);
      expect(names.filter((n) => /^(create|update|delete|tag|untag|link|unlink)_/.test(n))).toEqual([]);
      expect(hits([READER], /\b(INSERT|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/i)).toEqual([]);
    });

    it('the in-process servers offer a full replacement for Glob, Grep and Read', () => {
      // Item 14 stage one. Without this gate the claim is prose: the chat agent
      // reads the specification with filesystem builtins until something makes
      // the domain operations reachable, and `Glob **\/*.md` can see briefs.
      const inProcess = [
        path.join(SRC, 'server/mcp/reference-tools.ts'),
        path.join(SRC, 'server/mcp/entity-tools.ts'),
      ].flatMap(toolNames);
      for (const parity of ['list_pages', 'search_pages', 'get_page', 'get_section', 'list_sections']) {
        expect(inProcess, `no in-process tool named '${parity}'`).toContain(parity);
      }
    });

    /**
     * Three of this tier's review findings were the same mistake: a tool's
     * response shape or call form changed, the tool's own description was
     * updated, and a CONSUMER elsewhere in the repo kept reading the old one.
     * The chat renderer showed "Found 0 matches" beside a reply listing twelve,
     * and the system prompt kept teaching a call form that now hard-refuses.
     * Neither is reachable from a unit test of the tool.
     */
    it('no consumer still reads a response key this tier removed', () => {
      const renderers = fs.readFileSync(path.join(SRC, 'client/chat/toolRenderers.tsx'), 'utf-8');
      /**
       * Scoped to the two renderers whose tool changed shape — `results` is
       * still the right key for `get_entities` and the CRUD tools, so a
       * file-wide ban would be wrong rather than strict.
       */
      const rendererBlock = (name: string): string => {
        const start = renderers.indexOf(`\n  ${name}: {`);
        expect(start, `no ${name} renderer found`).toBeGreaterThan(-1);
        const next = renderers.indexOf('\n  },\n', start);
        return renderers.slice(start, next === -1 ? undefined : next);
      };
      expect(rendererBlock('search_entities'), 'search_entities renderer still reads the removed `results` grouping')
        .not.toMatch(/result\??[.!]\.?\??results\b/);
      expect(rendererBlock('list_tags'), 'list_tags renderer still reads the removed `tags` key')
        .not.toMatch(/result\??[.!]\.?\??tags\b/);
    });

    it('the chat prompt teaches the call form the tool actually accepts', () => {
      // `find_references` takes a required `target` discriminator. Every mention
      // that shows a call must show that form — a prompt that teaches the old
      // positional one costs a failed tool call on the move it calls reflex.
      const prompt = fs.readFileSync(path.join(SRC, 'server/services/chat-context.ts'), 'utf-8');
      expect(
        Array.from(prompt.matchAll(/find_references\((?!\{)/g)).map((m) => m[0]),
        'chat-context still shows a positional find_references(...) call',
      ).toEqual([]);
    });

    it('the chat agent is TOLD about every read tool it is given', () => {
      // `list_sections` shipped registered but unadvertised for a release: the
      // only reader that decides what to call never saw it. An unlisted tool is
      // an unused tool, so the advertisement is part of the surface.
      const advertised = fs.readFileSync(path.join(SRC, 'server/services/chat-context.ts'), 'utf-8');
      const line = /<mcp name="reference-tools">([^<]*)</.exec(advertised)?.[1] ?? '';
      const registered = toolNames(path.join(SRC, 'server/mcp/reference-tools.ts'));
      for (const name of registered) {
        expect(line, `reference-tools registers '${name}' but does not advertise it`).toContain(name);
      }
    });
  });

  it('every operation named in the brief exists on the core', () => {
    // Guards against a rename drifting the surface away from the contract the
    // transports and the skill documentation are written against.
    const source = fs.readFileSync(path.join(CORE, 'index.ts'), 'utf-8');
    for (const op of [
      'overview',
      'describeTypes',
      'listPages',
      'listSections',
      'getSection',
      'getPage',
      'searchPages',
      'searchEntities',
      'listEntities',
      'getEntities',
      'listTags',
      'findReferences',
      'checkConsistency',
      'resolveIdentity',
    ]) {
      expect(source).toContain(`${op}:`);
    }
  });
});
