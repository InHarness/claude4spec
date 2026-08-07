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
