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
