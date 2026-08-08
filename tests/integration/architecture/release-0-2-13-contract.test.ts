import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 0.2.13 — the parts of this release that were ALREADY true when it was
 * written, pinned so they cannot quietly stop being true.
 *
 * Every claim here corresponds to an item of brief `0-2-12-to-0-2-13` that
 * needed no code change. That makes them the easiest things in the release to
 * regress: nobody edited them, so nobody is watching them. A brief item with no
 * test is indistinguishable from a brief item nobody implemented.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (rel: string): string => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

/**
 * Tool names are declared as the first argument of a multi-line builder call
 * (`op(`, `mcpTool(`, `axisTool(`, …), so the name sits alone on its own line.
 * Matching that position is what distinguishes a DECLARATION from the dozens of
 * prose mentions of the same name inside tool descriptions.
 */
const declaresTool = (src: string, name: string): boolean =>
  new RegExp(`^\\s*'${name}',\\s*$`, 'm').test(src);

describe('breaking renames landed and stayed landed', () => {
  it('`resolve_page` is gone — a page is addressed by (rootId, path)', () => {
    // The same relPath in several roots was ambiguous; `get_page({rootId, path})`
    // replaced it. Asserted over the MCP surfaces, where the tool NAME lives.
    for (const f of ['src/server/mcp/c4s-reader.ts', 'src/server/mcp/reference-tools.ts']) {
      expect(declaresTool(read(f), 'resolve_page'), f).toBe(false);
      expect(declaresTool(read(f), 'get_page'), f).toBe(true);
    }
  });

  it('the singular `get_section` is gone — only the batch survives', () => {
    // Removed without a transition period: N sections cost N model turns.
    // Note `get_sections` CONTAINS `get_section`, so the trailing comma in
    // `declaresTool` is doing real work here.
    for (const f of ['src/server/mcp/c4s-reader.ts', 'src/server/mcp/reference-tools.ts']) {
      const src = read(f);
      expect(declaresTool(src, 'get_section'), f).toBe(false);
      expect(declaresTool(src, 'get_sections'), f).toBe(true);
    }
  });
});

describe('find_references carries includeTagMatches through every channel', () => {
  it('the core takes the flag', () => {
    expect(read('src/server/discovery/types.ts')).toMatch(/includeTagMatches\?: boolean/);
  });

  it('the CLI spells it --include-tag-matches', () => {
    expect(read('src/bin/c4s/args.ts')).toMatch(/include-tag-matches/);
  });

  it('the MCP tool exposes it', () => {
    expect(read('src/server/mcp/reference-tools.ts')).toMatch(/includeTagMatches/);
  });

  it('0.2.13: and so does REST, which is what closed the gap', () => {
    expect(read('src/server/routes/references.ts')).toMatch(/includeTagMatches/);
  });
});

describe('c4s-tools.ask takes an explicit workspace selector', () => {
  it('is optional, and an explicit value overrides the caller\'s workspace', () => {
    const src = read('src/server/mcp/c4s-tools.ts');
    // Required when a project path or slug belongs to N>1 workspaces — without
    // it, `ask` hits an AMBIGUOUS_WORKSPACE the caller cannot resolve.
    expect(src).toMatch(/workspace: z\s*\n?\s*\.string\(\)\s*\n?\s*\.optional\(\)/);
    expect(src).toMatch(/input\.workspace === 'string' \? input\.workspace : undefined\) \?\? callerWorkspace/);
  });
});

describe('spreadsheet declares all eight operations', () => {
  it('has the four window operations and the four that reindex', () => {
    const src = read('plugins/c4s-plugin-spreadsheets/src/entity/spreadsheet/mcp.ts');
    for (const name of ['get_overview', 'get_range', 'set_cell', 'set_range']) {
      expect(declaresTool(src, name), name).toBe(true);
    }
    // The four 0.2.13 adds, declared through the `axisTool` helper.
    // Non-idempotent, unlike set_cell/set_range: they shift every index after
    // the insertion/removal point, so cell coordinates are not stable across them.
    for (const name of ['insert_row', 'insert_column', 'delete_row', 'delete_column']) {
      expect(declaresTool(src, name), name).toBe(true);
    }
  });
});

describe('c4s agent --ct brief can mint a brief', () => {
  it('parses the create flags and posts them to /briefs', () => {
    const cli = read('src/bin/c4s/commands/agent.ts');
    for (const flag of ['source', 'from', 'to', 'roots', 'suffix']) {
      expect(cli, flag).toMatch(new RegExp(`'${flag}'`));
    }
    // Validation per source: release-diff needs from+to, initial forces from
    // null, analysis forces to null.
    expect(cli).toMatch(/release-diff/);
    expect(cli).toMatch(/initial/);
    expect(cli).toMatch(/analysis/);
    expect(read('src/core/agent/run-agent.ts')).toMatch(/\/briefs/);
  });
});

describe('page routes keep their static segments ahead of the read wildcard', () => {
  it('`/` and `/search` are registered before `GET /*`', () => {
    // Registration order IS the contract here: Express takes the first match, so
    // a static segment declared after the wildcard is dead. A page literally
    // named `search` must not be able to shadow the search endpoint.
    const src = read('src/server/routes/pages.ts');
    const tree = src.indexOf("router.get('/',");
    const search = src.indexOf("router.get('/search'");
    const wildcard = src.indexOf("router.get('/*'");
    expect(tree).toBeGreaterThan(-1);
    expect(search).toBeGreaterThan(-1);
    expect(wildcard).toBeGreaterThan(-1);
    expect(tree).toBeLessThan(wildcard);
    expect(search).toBeLessThan(wildcard);
  });
});

describe('the plugin-runtime facade is the only MCP builder', () => {
  it('no in-repo MCP server reaches past it to the vendor', () => {
    // The facade captures each server's tool declarations; a server built
    // straight from the vendor would be invisible to both the REST proxy and the
    // profile gate, and would fail OPEN in the gate (undeclared ⇒ admitted).
    const dir = path.join(REPO_ROOT, 'src/server/mcp');
    const files: string[] = [];
    const walk = (d: string): void => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts')) files.push(p);
      }
    };
    walk(dir);
    /**
     * What matters is the BUILDER's provenance, not the vendor's name appearing
     * in the file. Importing `type McpToolDefinition` from the vendor is fine and
     * unavoidable — it is the shape `mcpTool()` produces. The original check was
     * "mentions createMcpServer AND imports from the vendor", which conflated the
     * two and flagged a file that imports the builder from the facade and only a
     * type from the vendor.
     *
     * So: look at each vendor import clause and ask whether `createMcpServer` is
     * bound by it as a VALUE.
     */
    const offenders = files.filter((f) => {
      const src = fs.readFileSync(f, 'utf8');
      for (const m of src.matchAll(/import\s+(type\s+)?({[^}]*}|\w+)\s+from\s+'@inharness-ai\/agent-adapters'/g)) {
        if (m[1]) continue; // `import type { … }` binds no value
        const clause = m[2] ?? '';
        // Strip per-specifier `type` markers before looking for the builder.
        const values = clause.replace(/\btype\s+\w+(\s+as\s+\w+)?/g, '');
        if (/\bcreateMcpServer\b/.test(values)) return true;
      }
      return false;
    });
    expect(offenders.map((f) => path.relative(REPO_ROOT, f))).toEqual([]);
  });

  it('and no tool server hand-rolls the envelope the catalog declares', () => {
    /**
     * `operations/envelope.ts` was added by this release to end exactly this,
     * and its header says so: "Every MCP tool in the repo hand-rolled these two
     * shapes before 0.2.13, which is how `{error:{code,message}}` and
     * `{error,code}` both ended up on the wire." Then three tool servers written
     * or rewritten in this same release went on hand-rolling them, each
     * differently — `page-tools` forwarded `hint` and `currentHash`, `plan-tools`
     * forwarded neither, `brief-tools` forwarded only the message. So
     * `DomainError.hint`, the field this release added to carry the repair path,
     * was silently dropped on every plan and brief refusal, and
     * `decodeToolFailure` had to sniff two shapes coming back.
     *
     * A module documenting a problem is not the same as fixing it, and only a
     * gate keeps the next tool server from re-opening it.
     */
    const dir = path.join(REPO_ROOT, 'src/server/mcp');
    const offenders: string[] = [];
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue;
      const src = fs.readFileSync(path.join(dir, name), 'utf8');
      // A refusal envelope, spelled by hand: an isError result built inline.
      if (!/isError:\s*true/.test(src)) continue;
      if (/from '\.\.\/operations\/envelope\.js'/.test(src)) continue;
      offenders.push(name);
    }
    expect(offenders).toEqual([]);
  });
});

/**
 * Tier B — §3. These pin the things the move made TRUE BY ABSENCE, which is the
 * category no behavioural test can watch: a file that stopped opening a db, a
 * flag that stopped existing, a fallback that must not come back.
 */
describe('the external MCP surface has no second execution locus', () => {
  const bridge = () => read('src/bin/c4s-mcp.ts');

  it('the bridge opens no database and builds no core', () => {
    // Its whole former job. If any of these reappear, `c4s-mcp` is once again a
    // second implementation of operations the server already owns — the drift
    // this release exists to remove.
    for (const forbidden of [
      'openDbReadonly',
      'resolveWorkspaceProject',
      'RawEntityReader',
      'createDiscoveryCore',
      'createC4sReaderServer',
      'better-sqlite3',
    ]) {
      expect(bridge(), forbidden).not.toContain(forbidden);
    }
  });

  it('the bridge has no project selector — the project lives in the address', () => {
    // Asserted over what the ARG PARSER accepts, not over the file's text: the
    // header comment names both retired flags to explain why they are gone, and
    // a check that forbade the strings would forbid documenting the change.
    const parsed = [...bridge().matchAll(/a === '(--[a-z-]+)'/g)].map((m) => m[1]);
    expect(parsed).toContain('--url');
    expect(parsed).not.toContain('--project');
    expect(parsed).not.toContain('--workspace');
  });

  it('the bridge never starts a server', () => {
    // "Helpfully" spawning one would put an unsupervised second server on the
    // machine; falling back to local execution would restore the second locus.
    expect(bridge()).not.toMatch(/\bspawn\b|\bexecFile\b|child_process/);
  });

  it('mcp.json declares an HTTP mount, not a command to run', () => {
    const src = read('src/server/mcp/ensure-mcp-json.ts');
    expect(src).toContain("type: 'http'");
    expect(src).not.toContain("command: 'npx'");
  });

  it('the composed surface is reached only through the facade builder', () => {
    // Same rule as the gate above, stated for the file that composes N servers
    // into one: a tool that bypassed the facade would carry no declarations and
    // would therefore be invisible to the profile gate — failing OPEN.
    const src = read('src/server/mcp/surface.ts');
    expect(src).toContain("from '../plugin-runtime/index.js'");
    expect(src).toContain('gateServer');
  });
});

/**
 * Tier C — §2 and items 22, 24, 26. The `c4s` bin stops being a reader.
 *
 * These are the release's most breaking change, and they are all claims of
 * ABSENCE: no db handle, no serialization, no plugin loader driving the type
 * set. Absence is exactly what a normal test cannot observe — a command that
 * quietly reopened SQLite would still answer correctly on a machine where the
 * file happens to be there, and would still pass every behavioural test in the
 * suite. So these read the source.
 */
describe('the CLI holds no handle on the specification', () => {
  const cliSources = (): Array<{ file: string; text: string }> => {
    const out: Array<{ file: string; text: string }> = [];
    const walk = (dir: string): void => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, e.name);
        if (e.isDirectory()) walk(abs);
        else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts')) {
          out.push({ file: path.relative(REPO_ROOT, abs), text: fs.readFileSync(abs, 'utf8') });
        }
      }
    };
    walk(path.join(REPO_ROOT, 'src/bin/c4s'));
    out.push({ file: 'src/bin/c4s.ts', text: read('src/bin/c4s.ts') });
    return out;
  };

  it('[ac:ac-zero-logiki-formatowania-w-cli-subkome] the brief\'s own control grep returns nothing', () => {
    // Verbatim from item 22. It targets SERIALIZATION specifically because that
    // is the part that looks harmless to reintroduce: a command that formats one
    // entity locally is one `registerSerializer` away from a second L9 registry
    // that drifts from the server's by a package version.
    const forbidden = /config\.entities|registerSerializer|serializerRegistry|serialize\(host/;
    for (const { file, text } of cliSources()) {
      expect(forbidden.exec(text)?.[0], `${file} still touches CLI-side serialization`).toBeUndefined();
    }
  });

  it('[ac:ac-cli-otwiera-sqlite-wylacznie-readonly] nothing under bin/c4s opens a database', () => {
    // The handle itself, not just the reads through it. `openDbReadonly` was the
    // single door; better-sqlite3 is named too, so reopening it by hand does not
    // slip past.
    const forbidden = /openDbReadonly|better-sqlite3|db\/readonly\.js/;
    for (const { file, text } of cliSources()) {
      expect(forbidden.exec(text)?.[0], `${file} opens a db slot`).toBeUndefined();
    }
  });

  it('src/bin/c4s/context.ts is gone, not emptied', () => {
    // It resolved the project AND built a discovery core. A file left in place
    // with the core removed would invite the core back; `project-selector.ts`
    // carries the half that survived, and its name says what it does.
    expect(fs.existsSync(path.join(REPO_ROOT, 'src/bin/c4s/context.ts'))).toBe(false);
    expect(fs.existsSync(path.join(REPO_ROOT, 'src/bin/c4s/project-selector.ts'))).toBe(true);
  });

  it('[ac:ac-komenda-o-trybie-server-delegating-pr] exit 8 is SERVER_NOT_RUNNING, and INDEX_NOT_MATERIALIZED no longer claims it', () => {
    const bin = read('src/bin/c4s.ts');
    const eight = /case '([A-Z_]+)':\s*\n\s*return 8;/.exec(bin);
    expect(eight?.[1]).toBe('SERVER_NOT_RUNNING');
    expect(bin).not.toMatch(/case 'INDEX_NOT_MATERIALIZED':/);
  });

  it('a bad argument still exits 4 after the refusal started coming from the server', () => {
    /**
     * `routes/errors.ts` deliberately renames the core's `INVALID_ARGS` to
     * `VALIDATION` on the way out, and the CLI propagates the server's code
     * verbatim rather than translating it back. So when `file-patch` moved onto
     * `POST /api/patches`, the same refusal that exited 4 started exiting 1 —
     * the generic bucket that also holds `PROJECT_NOT_IN_WORKSPACE` and agent
     * failures, so a wrapper branching on `[ $? -eq 4 ]` reads a typo as an
     * infrastructure problem. All four spellings of "you asked for something the
     * contract does not allow" have to land on the same status.
     */
    const bin = read('src/bin/c4s.ts');
    const four = /((?:\s*case '[A-Z_]+':(?:\s*(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/))*)+\s*return 4;)/.exec(bin);
    expect(four, 'no exit-4 group found in codeToExit').toBeTruthy();
    const codes = [...four![1].matchAll(/case '([A-Z_]+)':/g)].map((m) => m[1]);
    expect(codes).toEqual(
      expect.arrayContaining(['INVALID_TYPE', 'INVALID_VIEW', 'INVALID_ARGS', 'INVALID_ARGUMENT', 'VALIDATION']),
    );
  });

  it('[ac:ac-kazda-komenda-modulowa-wchodzi-do-bin-c] the execution-mode enum no longer offers a way to read without a server', () => {
    const registry = read('src/bin/c4s/registry.ts');
    const union = /executionMode:\s*([^;]+);/.exec(registry)?.[1] ?? '';
    expect(union).toContain("'server-delegating'");
    // `readonly-reader` named the second execution locus. Removing the mode is
    // what makes reintroducing it a type error rather than a review comment.
    expect(union).not.toContain('readonly-reader');
  });

  it('[ac:ac-c4s-agent-c4s-ask-i-c4s-mark-brief] the bridge and the CLI agree that neither starts a server', () => {
    const help = read('src/bin/c4s.ts');
    expect(help).toMatch(/SERVER_NOT_RUNNING/);
    expect(help).toMatch(/never starts one/);
  });

  it('item 25: the CLI runs no plugin loader of its own', () => {
    /**
     * The last second locus in the process. `c4s plugins` used to bootstrap a
     * whole registry — built-in envelopes, workspace packages, project overlay —
     * and present the result as the project's plugin state. It was the state
     * THIS process would have loaded, which after any install is not the state
     * the running host is serving. Two loaders, two answers, and the question
     * these subcommands exist for is precisely the one where the wrong process's
     * answer is worse than no answer.
     *
     * `import type` stays allowed and is not an oversight: `plugins.ts` still
     * names `PluginLoadRecord` to describe what the route hands back, and a type
     * has no runtime existence — it cannot load anything.
     */
    const forbidden = /plugin-host\/loader\.js|plugin-host\/registry\.js|plugin-host\/overlay-loader\.js|serialization\/registerAll\.js|cli-plugins\.js/;
    for (const { file, text } of cliSources()) {
      for (const line of text.split('\n')) {
        if (!forbidden.test(line)) continue;
        // The only admissible form.
        expect(line.trimStart(), `${file} value-imports the plugin loader`).toMatch(/^import type /);
      }
    }
    // And the CLI-side loader is deleted, not merely unreferenced — a file left
    // in place is an invitation to call it again.
    expect(fs.existsSync(path.join(REPO_ROOT, 'src/server/core/plugin-host/cli-plugins.ts'))).toBe(false);
  });

  it('item 23: `fs-scoped` is down to its one legitimate member', () => {
    /**
     * The end state item 23 names. Asserting the CENSUS rather than the prose is
     * what makes it a gate: a command that quietly opts out of the server by
     * declaring `fs-scoped` fails here, and no other test would notice — it
     * would still typecheck, still dispatch, still pass its own unit tests, and
     * still be a second execution locus.
     */
    const dir = path.join(REPO_ROOT, 'src/bin/c4s/commands');
    const fsScoped: string[] = [];
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.ts') || f.endsWith('.test.ts')) continue;
      const text = fs.readFileSync(path.join(dir, f), 'utf8');
      const decl = /name: '([^']+)',[\s\S]{0,400}?executionMode: 'fs-scoped'/.exec(text);
      if (decl) fsScoped.push(decl[1]!);
    }
    expect(fsScoped).toEqual(['install-skills']);
  });

  it('item 8: every path that registers a project also writes its mcp.json', () => {
    /**
     * There are two, and 0.2.13 covered one.
     *
     * `bootstrapProject` used to write the file and stopped, because it could
     * only ever write `workspace.defaultPort` — wrong for a server started on
     * any other port. The replacement runs once after `listen`, over the
     * project list as it stood then. That leaves `activateProject` —
     * `POST /api/workspace/projects`, a project added through the workspace UI
     * — writing nothing at all: the directory gets no `mcp.json`, so the editor
     * shows no `c4s-spec-reader` server and the spec-reader skill has no MCP
     * surface until someone restarts.
     *
     * Asserted at the source, because the alternative is standing up a server
     * and a second project to observe one file appearing. The claim is narrow
     * and structural: the activation closure calls the writer.
     */
    const src = read('src/server/index.ts');
    const activate = /const activateProject = async[\s\S]*?\n  };/.exec(src)?.[0] ?? '';
    expect(activate, 'activateProject not found — the regex needs updating').toContain('bootstrapProject');
    expect(activate, 'a project added at runtime gets no mcp.json').toContain('ensureMcpJson');

    /**
     * …and it writes the CANONICAL port, not the one this process bound.
     *
     * The first version of this call passed `portRef.current`, which is the very
     * mistake `ensureMcpJsonForWorkspace` was rewritten to stop making: a one-off
     * `--port 5050`, a second instance, or `listenOrExit` retrying past a busy
     * port is not the address an editor should be sent to. A project added
     * through the UI of such a process got a config pointing at a port that dies
     * with it, while the canonical server keeps serving that project.
     */
    expect(activate, 'activateProject writes the bound port instead of the canonical one').not.toMatch(
      /port:\s*portRef\.current\s*[,}]/,
    );
    expect(activate).toContain('defaultPort');
  });

  it('item 22: the HELP text\'s exception list matches the actual non-delegating commands', () => {
    /**
     * The one place the release's central claim is stated to a HUMAN, and the
     * one that no other test reads. Item 22 rewrote this block and left
     * `plugins` in the exception list, where it stayed correct for exactly as
     * long as it took item 25 to move the command onto the server — after which
     * `c4s --help` told the reader that `plugins` works without a server while
     * the command exited 8 saying otherwise. Help text that contradicts the
     * binary is worse than no help text: it is the thing a user consults
     * BECAUSE the command failed.
     */
    const bin = read('src/bin/c4s.ts');
    const claimed = /Exceptions: ([^.]+)\./.exec(bin)?.[1] ?? '';
    const named = claimed.split(/,\s*|\s+and\s+/).map((s) => s.trim().replace(/`/g, '')).filter(Boolean);

    const dir = path.join(REPO_ROOT, 'src/bin/c4s/commands');
    const nonDelegating: string[] = [];
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.ts') || f.endsWith('.test.ts')) continue;
      const text = fs.readFileSync(path.join(dir, f), 'utf8');
      const decl = /name: '([^']+)',[\s\S]{0,400}?executionMode: '([^']+)'/.exec(text);
      if (decl && decl[2] !== 'server-delegating') nonDelegating.push(decl[1]!);
    }
    expect([...named].sort()).toEqual([...nonDelegating].sort());
  });
});

/**
 * Item 29 — the skills, which are the release's fourth channel in every sense
 * that matters to an agent reading one.
 *
 * Item 22 deleted the server-free subset of the CLI. Three shipped skills still
 * told their reader it existed, each in its own wording, and the wording was
 * load-bearing: it told the agent which failures were worth stopping for. A
 * skill that names a filesystem-scoped command instructs the agent to route
 * around a `SERVER_NOT_RUNNING` it cannot route around — and the way an agent
 * routes around a CLI it believes should have worked is by reading the spec
 * repo's files by hand, which every one of these skills forbids in its opening
 * paragraph.
 *
 * SIX files, not three. The generated copies under `.claude4spec/skills/` are
 * refreshed from the templates on server start; the copies under a repo's
 * `.claude/skills/` are hand-editable and deliberately never overwritten. This
 * repo has its own, customized with a git/PR flow, and a template-only fix would
 * leave THIS repo reading the stale contract — which is exactly how the two
 * copies drifted apart in the first place.
 */
describe('no skill claims a command that works without a server', () => {
  /**
   * The templates are RENDERED, not read as source. What ships is the output of
   * `briefImplementerBody(ctx)`, and the invariant reaches it through an
   * interpolated constant — so a gate reading the source file would be looking
   * at the one place the text is deliberately absent. The `.claude/skills/`
   * copies have no build step, so those are read as written.
   */
  const skillTexts = async (): Promise<Array<{ file: string; text: string }>> => {
    const ctx = { slug: 'demo', workspace: 'default' };
    const { briefImplementerBody } = await import('../../../src/server/external-skills/brief-implementer-template.js');
    const { refactorBody } = await import('../../../src/server/external-skills/refactor-template.js');
    const { specReaderBody } = await import('../../../src/server/external-skills/spec-reader-template.js');
    const out: Array<{ file: string; text: string }> = [
      { file: 'brief-implementer-template.ts (rendered)', text: briefImplementerBody(ctx) },
      { file: 'refactor-template.ts (rendered)', text: refactorBody(ctx) },
      { file: 'spec-reader-template.ts (rendered)', text: specReaderBody(ctx) },
    ];
    for (const s of ['c4s-brief-implementer', 'c4s-refactor', 'c4s-spec-reader']) {
      const rel = `.claude/skills/${s}/SKILL.md`;
      out.push({ file: rel, text: read(rel) });
    }
    return out;
  };

  it('none of the six asserts a server-free command', async () => {
    /**
     * Each pattern is one of the affirmative claims that was actually there,
     * phrased tightly enough that the shared block's own DENIAL of it ("there is
     * no filesystem-scoped subset") does not trip the gate. A denial and an
     * assertion are opposite statements; a grep that cannot tell them apart
     * would force the fix to be written without naming what it fixes.
     */
    const claims: Array<[RegExp, string]> = [
      [/without a running server/, 'says a command works without a server'],
      [/do(?: not|n't) need a server/, 'says a command needs no server'],
      [/[Uu]nlike the filesystem-scoped/, 'still divides the commands into scoped and delegating'],
      [/[Uu]nlike the read-only commands above/, 'still divides the commands into scoped and delegating'],
      [/database is opened \*\*read-only\*\*/, 'still describes a db handle the CLI no longer has'],
    ];
    for (const { file, text } of await skillTexts()) {
      for (const [re, why] of claims) {
        expect(re.exec(text)?.[0], `${file} ${why}`).toBeUndefined();
      }
    }
  });

  it('all six carry the invariant, and it says what to do', async () => {
    for (const { file, text } of await skillTexts()) {
      expect(text, `${file} has no "Server required" section`).toMatch(/## Server required — for every step/);
      expect(text, `${file} does not name the code to stop on`).toMatch(/SERVER_NOT_RUNNING/);
      // "Stop and ask" is the whole instruction. Without the second half a
      // reader is told the CLI needs a server and left to solve that themselves,
      // which is how a subagent ends up starting one.
      expect(text, `${file} does not forbid starting a server`).toMatch(/[Dd]o not start one yourself/);
    }
  });

  it('the templates say it once, not three times', () => {
    /**
     * Three wordings of one rule is how the previous three drifted apart. The
     * templates interpolate a single constant; only the hand-editable
     * `.claude/skills/` copies carry the text literally, because nothing
     * regenerates those.
     */
    for (const f of ['brief-implementer', 'refactor', 'spec-reader']) {
      const text = read(`src/server/external-skills/${f}-template.ts`);
      expect(text, `${f}-template inlines the block instead of importing it`).toMatch(
        /SERVER_REQUIRED_BLOCK/,
      );
      expect(text).not.toMatch(/## Server required — for every step/);
    }
  });
});

/**
 * Item 26, against the REAL contributions.
 *
 * `registry.test.ts` proves the check refuses a violation; this proves the
 * shipped commands contain none. Both are needed: a check nobody runs on the
 * real data is decoration, and a check run only on real data that happens to be
 * clean cannot be told apart from a check that always says yes.
 *
 * The contributions are PARSED rather than imported, for the same reason the
 * M39 reachability gate parses them: `src/bin/c4s.ts` runs `main()` at import,
 * so pulling the array in would execute the CLI.
 */
describe('[ac:ac-kontrybucja-komendy-jest-niepoprawna] every shipped command contribution is valid', () => {
  it('renders its catalog operation in server-delegating mode, or renders none', async () => {
    const { validateCommandContributions } = await import('../../../src/bin/c4s/registry.js');
    const { CATALOG } = await import('../../../src/server/operations/catalog.js');
    const { registerCoreOperations } = await import('../../../src/server/operations/core-operations.js');
    registerCoreOperations();

    const dir = path.join(REPO_ROOT, 'src/bin/c4s/commands');
    const parsed: Array<{
      name: string;
      operation?: string;
      executionMode: 'server-delegating' | 'fs-scoped' | 'registry-write' | 'scaffold';
      errorCodes: [];
      handler: () => Promise<void>;
    }> = [];
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))) {
      const text = fs.readFileSync(path.join(dir, f), 'utf8');
      const decl = /: CliCommandContribution = \{([\s\S]*?)\n\};/.exec(text)?.[1];
      if (!decl) continue;
      const name = /name: '([^']+)'/.exec(decl)?.[1];
      const mode = /executionMode: '([^']+)'/.exec(decl)?.[1];
      expect(name, `${f}: no name in the contribution`).toBeTruthy();
      expect(mode, `${f}: no executionMode in the contribution`).toBeTruthy();
      const operation = /operation: '([^']+)'/.exec(decl)?.[1];
      parsed.push({
        name: name!,
        ...(operation ? { operation } : {}),
        executionMode: mode as 'server-delegating',
        errorCodes: [],
        handler: async () => {},
      });
    }
    // A parse that found nothing would pass the assertion below vacuously.
    expect(parsed.length).toBeGreaterThan(20);

    const problems = validateCommandContributions(parsed, (n) => CATALOG.get(n) !== undefined);
    expect(problems).toEqual([]);
  });
});

/**
 * 0.2.13 item 28 — the page write path, and the built-in channel it closes.
 *
 * Both halves are here because they only mean anything together. The operations
 * without the lockdown are a second way to do the same thing; the lockdown
 * without the operations is an agent that cannot edit the specification.
 */
describe('a page is written by an operation, not by a file tool', () => {
  it('every page mutation in the server goes through the ONE primitive', () => {
    /**
     * The executable form of the catalog's "one function per operation".
     *
     * `PagesService.write`/`remove` are the raw file primitives. Before this
     * tier the REST handlers called them directly with the write token, the
     * `expectedHash` check and the re-hash inlined around each call — which is
     * exactly the shape a second channel copies badly. `services/page-write.ts`
     * and the section indexer's own anchor write-back are the only callers now,
     * and a new one would be a new locus.
     *
     * Deliberately NOT a grep over all of `src/server`: the indexer, the release
     * restore and the artifact mounts legitimately write markdown through the
     * same class. The gate names the file that regressed, which is the route.
     */
    const routes = read('src/server/routes/pages.ts');
    expect(/\.pages\.write\(|\.pages\.remove\(/.exec(routes)?.[0]).toBeUndefined();
    expect(routes).toContain("from '../services/page-write.js'");

    // …and the section route reaches the same module rather than growing its own.
    expect(read('src/server/routes/sections.ts')).toContain("from '../services/page-write.js'");
    expect(read('src/server/mcp/page-tools.ts')).toContain("from '../services/page-write.js'");
  });

  it('all four operations are declared, and declared as writes', async () => {
    // The class is what the profile gate filters on. A page write catalogued as
    // anything but `write` would be handed to `ask` by a gate doing its job.
    const { CATALOG } = await import('../../../src/server/operations/catalog.js');
    const { registerCoreOperations } = await import('../../../src/server/operations/core-operations.js');
    registerCoreOperations();
    for (const name of ['create_page', 'update_page', 'delete_page', 'update_section']) {
      const op = CATALOG.get(name);
      expect(op, `${name} is not in the catalog`).toBeDefined();
      expect(op!.opClass, name).toBe('write');
      expect(op!.sideEffects, name).toContain('file');
    }
    // `create_page` is the one that must NOT claim idempotence: a second call
    // with the same address is PAGE_EXISTS, and a caller retrying on a timeout
    // has to know that in advance.
    expect(CATALOG.get('create_page')!.idempotent).toBe(false);
    expect(CATALOG.get('update_page')!.idempotent).toBe(true);
  });

  it('[ac:ac-crud-stron-dziala-przez-ui-i-wbudowane-n] page roots are denied for WRITE and left open for READ', async () => {
    /**
     * The distinction this whole tier turns on.
     *
     * The obvious implementation — fold the roots into the artifact deny-set —
     * would pass a test that only checked "the roots are denied somewhere",
     * while silently taking `Read`/`Grep`/`Glob` over the specification away
     * from the agent. So the assertion is a THREE-way one: in `denyWrite`,
     * absent from `denyRead`, absent from `disallowedPaths`. The artifact dirs
     * are asserted in both lists in the same test, which is what makes it able
     * to tell the two lists apart at all rather than passing on either.
     */
    const os = await import('node:os');
    const { resolveAgentExecutionScope } = await import(
      '../../../src/server/services/agent-execution-scope.js'
    );
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-item28-'));
    try {
      fs.mkdirSync(path.join(cwd, '.claude4spec'), { recursive: true });
      fs.writeFileSync(
        path.join(cwd, '.claude4spec/config.json'),
        JSON.stringify({ $schemaVersion: 4, name: 'p', entities: [] }),
      );
      const scope = resolveAgentExecutionScope({
        cwd,
        roots: [
          { id: 'pages', name: 'Pages', dir: 'pages', builtin: true },
          { id: 'guides', name: 'Guides', dir: 'docs/guides', builtin: false },
        ] as never,
      });

      const roots = [path.join(cwd, 'pages'), path.join(cwd, 'docs/guides')];
      for (const root of roots) {
        expect(scope.claudeSandbox.filesystem.denyWrite, root).toContain(root);
        expect(scope.claudeSandbox.filesystem.denyRead, root).not.toContain(root);
        // Not in `disallowedPaths` either — that list is what the vendor turns
        // into symmetric Read+Edit+Write permission rules, and what the resume
        // lock compares, so putting a root there would also relock every thread.
        expect(scope.disallowedPaths, root).not.toContain(root);
      }

      // The artifact dirs stay symmetric — the control that gives the assertions
      // above their meaning.
      const entities = path.join(cwd, '.claude4spec/entities');
      expect(scope.claudeSandbox.filesystem.denyWrite).toContain(entities);
      expect(scope.claudeSandbox.filesystem.denyRead).toContain(entities);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('the prompt states the write rule where the agent will read it', () => {
    /**
     * The prompt line is not decoration — measured against a live turn, it is
     * currently the WHOLE gate.
     *
     * `agent-adapters` bypasses permissions entirely when an OS sandbox is
     * present and puts the deny lists in `options.sandbox.filesystem`, which the
     * Agent SDK does not use for filesystem restriction. The pre-existing
     * 0.1.130 artifact hard-lock is equally inert for the same reason. So this
     * assertion guards the only thing that actually reaches the model today, and
     * it has to name all four operations for the sentence to be actionable.
     */
    const ctx = read('src/server/services/chat-context.ts');
    for (const op of ['create_page', 'update_page', 'delete_page', 'update_section']) {
      expect(ctx, `the path-scope block never names ${op}`).toContain(op);
    }
  });
});
