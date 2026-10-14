/**
 * The whole stack, on the REAL type rather than a fixture.
 *
 * `mcp-tool` arrives through the host's registration point from this package's
 * manifest; nothing here constructs the module.
 * That is the claim that matters most for a type whose entire backend is
 * derived: if registration silently drops the package (a version gate, a schema
 * the validator refuses), the failure is not an error anywhere — the host simply
 * has no `mcp-tool`, and `describe_entity_type` answers `INVALID_TYPE`.
 *
 * 2.1.20 (M33 `ywud56l6`): the host is reached through the host repo's
 * internal, unpublished test setup, `@c4s-internal/plugin-test-setup`, with the
 * package's own manifest handed to `createPluginTestApp`. The specifier is a
 * test-config alias, so moving this package out of the host repo changes no
 * import here — but the tests have to be re-wired to a published harness then.
 * Discovery of the built bundle by `loadBuiltinEnvelopes` is the host's claim
 * and is pinned by the host's own suites, not by this package.
 */

import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPluginTestApp, type PluginTestApp } from '@c4s-internal/plugin-test-setup';
import { manifest } from '../src/manifest.js';

const TOOL = {
  name: 'read_page',
  server: 'claude4spec',
  description: 'Read one specification page by path.',
  params: [
    { name: 'path', type: 'string', required: true, description: 'Page path.' },
    { name: 'section', type: 'string', description: 'Anchor of a single section.' },
  ],
  returns: 'The page body as markdown, with its frontmatter.',
  readOnlyHint: true,
  logic: 'Resolve the path against the project root, refuse anything escaping it, then read.',
};

describe('mcp-tool — the shipped type', () => {
  let t: PluginTestApp;

  beforeEach(async () => {
    t = await createPluginTestApp([manifest]);
    await t.crud.create('mcp-tool', TOOL, 'user');
    t.broadcasts.length = 0;
  });
  afterEach(() => t.cleanup());

  const row = (slug = 'claude4spec-read-page') =>
    t.db.prepare('SELECT * FROM mcp_tool WHERE slug = ?').get(slug) as
      | Record<string, unknown>
      | undefined;
  const entityFile = (slug = 'claude4spec-read-page') =>
    JSON.parse(
      fs.readFileSync(path.join(t.cwd, `.claude4spec/entities/mcp-tool/${slug}.json`), 'utf8'),
    );

  it('is registered from the package manifest through the host registration point', () => {
    expect(t.host.listEntities().map((m) => m.type)).toContain('mcp-tool');
  });

  it('derives the slug from server and name', () => {
    expect(row()?.slug).toBe('claude4spec-read-page');
  });

  it('derives the title as `{server} · {name}`, keeping case and spacing', () => {
    expect(row()?.title).toBe('claude4spec · read_page');
  });

  /**
   * `params` carries no `keyFields`, so it stays embedded JSON on this row
   * rather than projecting to a table of its own. Pinned because the difference
   * is invisible until something queries across tools and finds no table.
   */
  it('embeds params as JSON on the row, with no projection table of its own', () => {
    expect(JSON.parse(String(row()?.params))).toHaveLength(2);
    const tables = t.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'mcp_tool%'")
      .all() as Array<{ name: string }>;
    expect(tables.map((x) => x.name)).toEqual(['mcp_tool']);
  });

  /**
   * THE EDGE CASE A RENDERER CAN QUIETLY COLLAPSE. An unset hint means "the
   * server declares no annotation", which is not the protocol's default and not
   * an explicit `false`. It has to survive the row, the file and the read.
   */
  it('keeps an undeclared hint distinguishable from an explicit false', async () => {
    const r = row();
    expect(r?.read_only_hint).toBe(1);
    expect(r?.destructive_hint).toBeNull();

    // `null` in the file, not absent — a clearable field that was never set is
    // emitted explicitly, which is what keeps "no annotation" readable rather
    // than inferable from a missing key.
    expect(entityFile().destructiveHint).toBeNull();

    /**
     * A declared `false` reaches the file as `0`, not as `false`. That is the
     * host's storage of every top-level boolean — the whole `spreadsheet` corpus
     * carries `"headerRow": 1` — and it is fine HERE precisely because the
     * distinction this type depends on is null-vs-set, not `false`-vs-`0`. What
     * a renderer must never do is read the falsy `0` as "absent".
     */
    await t.crud.update('mcp-tool', 'claude4spec-read-page', { destructiveHint: false }, 'user');
    expect(row()?.destructive_hint).toBe(0);
    expect(entityFile().destructiveHint).toBe(0);
    expect(entityFile().destructiveHint).not.toBeNull();
  });

  it('round-trips the whole record into the entity file, logic included', () => {
    const file = entityFile();
    expect(file.logic).toBe(TOOL.logic);
    /**
     * `params[].required` is stored ABSENT when omitted, not `false`.
     *
     * The declaration carries `default: false` on that item field, but the host
     * materialises defaults only for TOP-LEVEL fields — a `default` inside a
     * collection item is inert, and no other type in the repo declares one. This
     * is harmless for `required` (absent and `false` mean the same thing to every
     * reader of a parameter list) and is pinned here so the asymmetry with the
     * four top-level hints — where absent and `false` mean DIFFERENT things — is
     * a recorded fact rather than a surprise. Filed back to the spec as drift.
     */
    expect(file.params).toEqual(TOOL.params);
    expect(file.payloadVersion).toBe(1);
  });
});
