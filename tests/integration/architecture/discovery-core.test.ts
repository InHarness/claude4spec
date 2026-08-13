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
  it('[ac:ac-registry-l9-jest-wolane-wylacznie-prz] the serialization registry is invoked only from the core', () => {
    const outside = sourceFiles(SRC).filter(
      (f) =>
        isProduction(f) &&
        !f.startsWith(CORE) &&
        // The engine IS the registry — it defines these, it does not consume them.
        !f.endsWith('core/plugin-host/serialization-engine.ts'),
    );
    expect(hits(outside, /\.serialize(Entity|Section)\(|\.serializer\.schema/)).toEqual([]);
  });

  /**
   * 0.2.9 (tier B, item 15) — the acceptance criterion, as a test.
   *
   * The item states it as a grep: `serializerRegistry|registerSerializer` must
   * return nothing outside git history. That has been true since the singleton
   * became a per-context engine, which is exactly why it needs a guard — a
   * criterion nobody can fail is a criterion nobody maintains. The second half
   * is the one that had teeth when this was written: `entity-tools` reached the
   * engine directly through a dep it called `registry`, so the grep passed while
   * a transport was doing precisely what the item forbids.
   */
  it('[ac:ac-registry-l9-jest-wolane-wylacznie-prz] no global serializer registry exists, and no transport reaches the engine', () => {
    expect(hits(sourceFiles(SRC).filter(isProduction), /serializerRegistry|registerSerializer/)).toEqual([]);

    /**
     * A transport may CONSTRUCT the engine — the CLI and the stdio server both
     * build one and hand it to the core, which is how the core gets it at all —
     * but it may not CALL one. So the rule is about invocation, not about the
     * type name appearing in a wiring file.
     */
    const TRANSPORTS = ['bin', 'server/mcp', 'server/routes', 'server/core/plugin-host/entities-router.ts'];
    const transportFiles = sourceFiles(SRC).filter(
      (f) => isProduction(f) && TRANSPORTS.some((t) => f.startsWith(path.join(SRC, t))),
    );
    expect(
      hits(transportFiles, /\.(describe|getSchema|getPayloadVersion|catalog|views)\(\s*['"`]?\w*['"`]?\s*[,)]/),
    ).toEqual([]);
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
        'get_sections',
        'get_page',
        'search_pages',
        'search_entities',
        'list_entities',
        'get_entities',
        // 0.2.22 — the operation that hands over what a content-bearing field
        // withholds from every generic read.
        'get_field_content',
        'list_tags',
        'find_references',
        'check_consistency',
        'resolve_identity',
      ];
      expect(declared.sort()).toEqual([...expected].sort());
    });

    it('every tool a later release replaced is gone from c4s-reader', () => {
      // Not a subset relationship: each of these fronted an operation that was
      // renamed or absorbed, and `resolve_page` fronted one that was withdrawn.
      // Leaving any of them behind would ship two answers to the same question.
      //
      // The pattern matches BOTH declaration spellings. It used to look only for
      // `mcpTool(`, which this file's own helper already knew was half the story
      // — every tool in `c4s-reader` is declared through the `op(...)` wrapper,
      // so the assertion could not have failed for any name on this list. A gate
      // that cannot fail is worse than no gate: it reads as coverage.
      const source = readerSource();
      for (const gone of [
        'get_entity',
        'get_section',
        'find_by_tag',
        'resolve_page',
        'catalog',
        'describe',
        'list_slugs',
      ]) {
        expect(source, `c4s-reader still declares '${gone}'`).not.toMatch(
          new RegExp(`(?:mcpTool|op)\\(\\s*\\n?\\s*'${gone}'`),
        );
      }
    });

    /**
     * 0.2.5 — "fetch by key" is the SECOND kind of exemption from the rule that
     * every listing tool paginates.
     *
     * The first kind is a response bounded by construction (`overview`,
     * `describe_types`), which gets a projection instead. `get_entities` and
     * `get_sections` are different: the caller names the rows, so the height of
     * the result is its choice rather than the collection's. Their valve is the
     * input-length cap plus the response budget — an over-long list is
     * `INVALID_ARGUMENT`, an over-budget response is cut deterministically and
     * says so.
     *
     * Until now this was prose in `pagination.ts` and an accident of which
     * declarations happened to spread `pageShape`. Nothing asserted it, so
     * `limit`/`offset` could be added to a fetch-by-key tool (giving it two
     * disagreeing valves) or dropped from a listing one (making it unbounded)
     * and the suite would stay green.
     */
    it('fetch-by-key tools take no limit/offset, and every other listing tool does', () => {
      const source = readerSource();
      /** The body of one `op('name', …)` declaration, up to the next one. */
      const declaration = (name: string): string => {
        const start = source.search(new RegExp(`op\\(\\s*\\n?\\s*'${name}'`));
        expect(start, `no declaration of '${name}' in c4s-reader`).toBeGreaterThan(-1);
        const next = source.indexOf('\n  const ', start);
        return source.slice(start, next === -1 ? undefined : next);
      };

      for (const byKey of ['get_entities', 'get_sections']) {
        const decl = declaration(byKey);
        expect(decl, `'${byKey}' is fetch-by-key and must not paginate`).not.toMatch(/pageShape|\blimit:|\boffset:/);
      }

      // The counterpart: a tool that returns a COLLECTION the caller did not
      // enumerate has to be bounded, or one call can return the whole project.
      for (const listing of [
        'list_pages',
        'list_sections',
        'search_pages',
        'search_entities',
        'list_entities',
        'list_tags',
        'find_references',
      ]) {
        expect(declaration(listing), `'${listing}' returns a collection and must paginate`).toContain('pageShape');
      }
    });

    it('no tool on c4s-reader can mutate', () => {
      // The read-only guarantee an external agent relies on is structural: the
      // core exposes no write, so there is no path to one from this process.
      // A mutating NAME here would mean someone had found another path.
      const names = toolNames(READER);
      expect(names).toHaveLength(15);
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
      for (const parity of ['list_pages', 'search_pages', 'get_page', 'get_sections', 'list_sections']) {
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

  /**
   * 0.2.6 — the CLI walks no directories of its own.
   *
   * `find-references` used to `readdir` the page roots itself, so the reference
   * sweep existed twice: once in the core behind the server and once here,
   * agreeing only while somebody kept them agreeing. They had already drifted —
   * the CLI copy dropped `rootId` from every hit, making two roots'
   * results indistinguishable. The claim "one walk, three transports" is a claim
   * about code that does not exist, so it is asserted the only way such a claim
   * can be: by failing the build when it comes back.
   */
  it('src/bin/c4s reads no directories — the walk belongs to the core', () => {
    const found = hits(sourceFiles(path.join(SRC, 'bin/c4s')), /\breaddir(Sync)?\b|\bopendir(Sync)?\b/);
    expect(found, `page/root iteration in the CLI: ${found.join(', ')}`).toEqual([]);
  });

  /**
   * The CLI stops narrowing the core's operation set. Parity is OPERATIONAL, not
   * nominal: six commands are aliases of `get_entities`/`list_entities` with a
   * fixed view, and `list-slugs` is the minimal-view shorthand. What must not
   * happen is an operation reachable from MCP and from nowhere on the CLI —
   * silently, because nobody wrote the command.
   */
  it('every core operation is reachable from the c4s bin', () => {
    /**
     * The REGISTERED command list, not the file text.
     *
     * Asserting `expect(binSource).toContain('list-pages')` was vacuous: the
     * HELP string in the same file lists every command name, so deleting a
     * contribution from the `COMMANDS` array left the assertion green while
     * `c4s list-pages` died with UNKNOWN_COMMAND at runtime — the gate could not
     * fail for the thing it exists to catch. The bin cannot simply be imported
     * (its top level runs `main()`), so the array literal is parsed instead and
     * the identifiers in it are resolved against each command module's declared
     * `name`.
     */
    const bin = fs.readFileSync(path.join(SRC, 'bin/c4s.ts'), 'utf-8');
    const arrayBlock = /const COMMANDS: CliCommandContribution\[\] = \[([\s\S]*?)\n\];/.exec(bin)?.[1];
    expect(arrayBlock, 'could not find the COMMANDS array in src/bin/c4s.ts').toBeTruthy();
    const registeredIdentifiers = new Set(
      arrayBlock!
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .map((l) => /^\s*([A-Za-z0-9_]+),\s*$/.exec(l)?.[1])
        .filter((x): x is string => Boolean(x)),
    );

    // `export const fooCommand: CliCommandContribution = { name: 'foo-bar', … }`
    // — the identifier the array must contain, keyed by the name a user types.
    const identifierByCommandName = new Map<string, string>();
    const commandFilesText: string[] = [];
    for (const file of sourceFiles(path.join(SRC, 'bin/c4s/commands')).filter((f) => !f.endsWith('.test.ts'))) {
      const text = fs.readFileSync(file, 'utf-8');
      commandFilesText.push(text);
      for (const m of text.matchAll(
        /export const ([A-Za-z0-9_]+): CliCommandContribution = \{\s*\n\s*name: '([^']+)'/g,
      )) {
        identifierByCommandName.set(m[2]!, m[1]!);
      }
    }
    const commandFiles = commandFilesText.join('\n');

    /**
     * 0.2.13 (item 22) — reachability is asserted through the DECLARATION, not
     * through an import of the core.
     *
     * This block used to require that some command file contained
     * `.overview(` — evidence that a command called the discovery core in the
     * `c4s` process. That evidence is now the opposite of what should be true:
     * executing a catalog operation belongs to the server process, and a command
     * importing the core would be the second locus this release removed. If the
     * old form were kept, the only way to make it pass again would be to
     * reintroduce the bug.
     *
     * So each M39 operation must be named by a `server-delegating` contribution
     * instead. That is a STRONGER claim than the old one: it pins the mode as
     * well as the reachability, and `validateCommandContributions` (item 26)
     * separately checks that a named operation exists in the catalog.
     */
    const operationByCommandName = new Map<string, string>();
    const modeByCommandName = new Map<string, string>();
    for (const text of commandFilesText) {
      for (const m of text.matchAll(
        /name: '([^']+)',\s*\n(?:\s*operation: '([^']+)',\s*\n)?(?:\s*(?:\/\/[^\n]*\n|\s*\/\*[\s\S]*?\*\/\s*\n)*)\s*executionMode: '([^']+)'/g,
      )) {
        if (m[2]) operationByCommandName.set(m[1]!, m[2]);
        modeByCommandName.set(m[1]!, m[3]!);
      }
    }

    for (const [operation, reachedBy] of [
      ['overview', 'catalog'],
      ['describe_types', 'describe'],
      ['list_pages', 'list-pages'],
      ['list_sections', 'list-sections'],
      ['get_sections', 'get-sections'],
      ['get_page', 'get-page'],
      ['search_pages', 'search-pages'],
      ['search_entities', 'search-entities'],
      ['list_entities', 'list-entities'],
      ['get_entities', 'get-entities'],
      ['get_field_content', 'get-field-content'],
      ['list_tags', 'list-tags'],
      ['find_references', 'find-references'],
      ['check_consistency', 'check-consistency'],
      ['resolve_identity', 'resolve-identity'],
    ] as const) {
      const identifier = identifierByCommandName.get(reachedBy);
      expect(identifier, `no command module declares name: '${reachedBy}'`).toBeTruthy();
      expect(
        registeredIdentifiers.has(identifier!),
        `'${reachedBy}' (${identifier}) is declared but not in the COMMANDS array — it would be UNKNOWN_COMMAND at runtime`,
      ).toBe(true);
      expect(
        operationByCommandName.get(reachedBy),
        `'${reachedBy}' must declare operation: '${operation}' — that declaration is the only record of which catalog operation the CLI renders`,
      ).toBe(operation);
      expect(
        modeByCommandName.get(reachedBy),
        `'${reachedBy}' renders a catalog operation, so its mode must be 'server-delegating'`,
      ).toBe('server-delegating');
    }

    /**
     * The counterpart, and the reason the assertion above had to change shape:
     * no command may import a VALUE from the discovery core any more.
     *
     * `import type` is deliberately allowed and is not a loophole. A type is
     * erased at compile time — it carries no execution — and the shapes the core
     * answers with are exactly what a transport has to name in order to unwrap a
     * response without inventing its own vocabulary for it. What would be a
     * second execution locus is `import { createDiscoveryCore }` or
     * `import { listEntitiesAll }`, and that is what this matches.
     */
    const valueImport = /import\s+(?!type\b)[^;]*?from\s+'[^']*\/server\/discovery\//;
    for (const text of commandFilesText) {
      const hit = valueImport.exec(text);
      expect(
        hit?.[0],
        'a command imports a VALUE from the discovery core: executing a catalog operation belongs to the server process',
      ).toBeUndefined();
    }
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
      'getSections',
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
