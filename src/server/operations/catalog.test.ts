import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  CATALOG,
  OperationCatalog,
  OperationCatalogError,
  direct,
  na,
  type ChannelName,
  type OperationDeclaration,
} from './catalog.js';
import { registerCoreOperations } from './core-operations.js';
import { KNOWN_OPERATION_CLASSES, PROFILES, mcpServerSetForProfile, profileAdmits } from './profiles.js';
import { pluginServerNamesFor, toolAdmittedByProfile, withheldTools } from './profile-gate.js';
import { toolError, toolSuccess } from './envelope.js';
import { httpStatusForCode } from './error-codes.js';
import { createC4sReaderServer } from '../mcp/c4s-reader.js';
import { createReferenceToolsServer, type ReferenceToolsDeps } from '../mcp/reference-tools.js';
import { buildEntityTools, type EntityToolsDeps } from '../mcp/entity-tools.js';
import { READ_TOOL_RECORDS } from '../../../tests/helpers/read-tool-records.js';
import { WRITE_TOOL_RECORDS } from '../../../tests/helpers/write-tool-records.js';
import { createEndpointToolsServer } from '../../../plugins/c4s-plugin-api-contracts/src/entity/endpoint/backend/mcp.js';
import type { LinkDtoDeps } from '../../../plugins/c4s-plugin-api-contracts/src/entity/endpoint/backend/link-dto.js';

registerCoreOperations();

const CHANNELS: ChannelName[] = ['internal', 'cli', 'mcp', 'rest'];

/** A minimal valid declaration, for the registry's own rules. */
const decl = (over: Partial<OperationDeclaration> = {}): OperationDeclaration => ({
  name: 'get_thing',
  summary: 'x',
  scope: 'project',
  mediation: 'direct',
  opClass: 'read',
  inputSchema: {},
  errorCodes: [],
  sideEffects: ['none'],
  idempotent: true,
  channels: { internal: direct(), cli: direct(), mcp: direct(), rest: direct() },
  ...over,
});

describe('operation catalog — declaration rules', () => {
  /**
   * 0.2.37 — the same class of rule as the missing-cell one below, and here for
   * the same reason: an operation that writes a file without saying how its
   * content is described leaves a reader inferring "no differential mode" from
   * an absence, which is indistinguishable from someone having forgotten.
   */
  it('rejects a file-writing declaration that does not declare contentInput', () => {
    const cat = new OperationCatalog();
    const broken = decl({ name: 'update_thing', opClass: 'write', sideEffects: ['file', 'db'] });
    expect(() => cat.register(broken)).toThrow(OperationCatalogError);
    expect(() => cat.register(broken)).toThrow(/does not declare 'contentInput'/);
  });

  it('leaves operations with no file side effect free of the requirement', () => {
    const cat = new OperationCatalog();
    expect(() => cat.register(decl({ sideEffects: ['db'] }))).not.toThrow();
  });

  it('[ac:ac-kazdy-wiersz-katalogu-l3-opisujacy-op] every registered file-writing operation declares one', () => {
    const writesFiles = CATALOG.list().filter((op) => op.sideEffects.includes('file'));
    // A guard against the guard: if this ever comes back empty the assertion
    // below would pass while proving nothing.
    expect(writesFiles.length).toBeGreaterThan(5);
    for (const op of writesFiles) {
      expect(['literal', 'diff', 'literal+diff', 'n/a'], op.name).toContain(op.contentInput);
    }
    // The two page-content writes the criterion names say "both" explicitly.
    expect(CATALOG.require('update_page').contentInput).toBe('literal+diff');
    expect(CATALOG.require('update_sections').contentInput).toBe('literal+diff');
  });

  it('the three operations that got a differential mode declare it, and the three that did not say so', () => {
    expect(CATALOG.require('update_page').contentInput).toBe('literal+diff');
    expect(CATALOG.require('update_sections').contentInput).toBe('literal+diff');
    // 0.2.43: `update_plan` joined them; 0.2.86: `update_brief` too (M43
    // `diff-mode-declared` — the brief was the named remaining consumer).
    expect(CATALOG.require('update_plan').contentInput).toBe('literal+diff');
    expect(CATALOG.require('update_brief').contentInput).toBe('literal+diff');
    for (const name of ['update_entities', 'create_patch']) {
      expect(CATALOG.require(name).contentInput, name).toBe('literal');
    }
  });

  it('rejects a declaration missing a channel cell', () => {
    const cat = new OperationCatalog();
    const broken = decl({
      channels: { internal: direct(), cli: direct(), mcp: direct() } as never,
    });
    expect(() => cat.register(broken)).toThrow(OperationCatalogError);
    expect(() => cat.register(broken)).toThrow(/no 'rest' cell/);
  });

  it('rejects a name that is not snake_case', () => {
    const cat = new OperationCatalog();
    expect(() => cat.register(decl({ name: 'getThing' }))).toThrow(/snake_case/);
    expect(() => cat.register(decl({ name: 'get__thing' }))).toThrow(/snake_case/);
    expect(() => cat.register(decl({ name: '_get' }))).toThrow(/snake_case/);
  });

  it('rejects a duplicate registration rather than silently replacing it', () => {
    const cat = new OperationCatalog();
    cat.register(decl());
    expect(() => cat.register(decl())).toThrow(/already registered/);
  });

  it('accepts an `na` cell — a declared gap is legal, an undeclared one is not', () => {
    const cat = new OperationCatalog();
    const op = cat.register(
      decl({ name: 'list_projects', channels: { internal: direct(), cli: direct(), mcp: direct(), rest: na('deferred') } }),
    );
    expect(op.channels.rest).toEqual({ kind: 'na', reason: 'deferred' });
  });
});

describe('the seeded catalog', () => {
  it('every declaration answers for all four channels', () => {
    for (const op of CATALOG.list()) {
      for (const channel of CHANNELS) {
        expect(op.channels[channel], `${op.name}.${channel}`).toBeDefined();
      }
    }
  });

  it('an `na` cell always carries a written reason', () => {
    for (const op of CATALOG.list()) {
      for (const channel of CHANNELS) {
        const cell = op.channels[channel];
        if (cell.kind === 'na') {
          expect(cell.reason.length, `${op.name}.${channel}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('declares every M39 read operation with full four-channel parity, bar the three with a recorded reason', () => {
    const M39 = [
      'describe_types',
      'list_pages',
      'get_sections',
      'search_pages',
      'search_entities',
      'list_entities',
      'get_entities',
      'list_tags',
      'find_references',
      'check_consistency',
      'resolve_identity',
    ];
    expect(M39).toHaveLength(11);
    for (const name of M39) {
      const op = CATALOG.get(name);
      expect(op, name).toBeDefined();
      expect(op!.scope).toBe('project');
      expect(op!.mediation).toBe('direct');
      expect(op!.opClass).toBe('read');
      expect(op!.sideEffects).toEqual(['none']);
      for (const channel of CHANNELS) {
        expect(op!.channels[channel].kind, `${name}.${channel}`).toBe('direct');
      }
    }
  });

  /**
   * 0.2.92 — `direct` is an expectation, not an exemption. For `internal` and
   * `mcp` it holds only with a pointable rendering: a declared tool rendering the
   * operation in that channel. A `direct` cell with none makes the row INVALID —
   * so this is a failing assertion, never a TODO list.
   *
   * Parity is operational, not nominal: one rendering may carry another name
   * (`describe_entity_type` renders `describe_types` internally), and the alias
   * is written down here rather than inferred.
   */
  it('[ac:ac-wiersz-katalogu-operacji-o-wartosci-d] every internal/mcp `direct` cell of an M39 row has a declared rendering', () => {
    const mcpDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../mcp');
    const declared = (file: string): Set<string> =>
      new Set(
        Array.from(fs.readFileSync(path.join(mcpDir, file), 'utf-8').matchAll(/\b(?:mcpTool|op)\(\s*\n?\s*'([a-z_]+)'/g)).map(
          (m) => m[1]!,
        ),
      );
    const external = declared('c4s-reader.ts');
    const inProcess = new Set([...declared('entity-tools.ts'), ...declared('reference-tools.ts')]);
    const INTERNAL_ALIAS: Record<string, string> = { describe_types: 'describe_entity_type' };

    const m39 = [...external];
    expect(m39).toHaveLength(15);
    const invalid: string[] = [];
    for (const name of m39) {
      const op = CATALOG.require(name);
      if (op.channels.internal.kind === 'direct' && !inProcess.has(INTERNAL_ALIAS[name] ?? name)) {
        invalid.push(`${name}.internal`);
      }
      if (op.channels.mcp.kind === 'direct' && !external.has(name)) invalid.push(`${name}.mcp`);
      if (op.channels.internal.kind === 'na' && inProcess.has(name)) invalid.push(`${name}.internal says n/a but renders`);
    }
    expect(invalid).toEqual([]);
  });

  /**
   * 0.2.92 — `overview` has no `internal` rendering, and that is a decision: the
   * prompt carries roots, active types and tooling statically, and record counts
   * are `list_entities({ mode: 'count' })`. The two M39 `n/a` cells have
   * disjoint reasons — one channel each.
   */
  it('`overview` declares its internal gap rather than claiming parity', () => {
    const op = CATALOG.require('overview');
    expect(op.channels.internal.kind).toBe('na');
    expect((op.channels.internal as { reason: string }).reason).toContain("list_entities({ mode: 'count' })");
    expect(op.channels.cli.kind).toBe('direct');
    expect(op.channels.mcp.kind).toBe('direct');
    expect(op.channels.rest.kind).toBe('direct');

    const m39NaCells = ['overview', 'get_page_outline', 'get_page'].flatMap((name) =>
      CHANNELS.filter((ch) => CATALOG.require(name).channels[ch].kind === 'na').map((ch) => `${name}.${ch}`),
    );
    expect(m39NaCells).toEqual(['overview.internal', 'get_page_outline.rest', 'get_page.rest']);
  });

  /**
   * 2.1.6 — the structured `get_page` has no REST rendering: `GET /api/pages/:rootId/*`
   * is M02's raw read for the editor (`page-detail`), not a transport over it.
   */
  it('`get_page` declares its REST gap, naming the editor route it is not', () => {
    const op = CATALOG.require('get_page');
    expect(op.channels.internal.kind).toBe('direct');
    expect(op.channels.cli.kind).toBe('direct');
    expect(op.channels.mcp.kind).toBe('direct');
    expect(op.channels.rest.kind).toBe('na');
    expect((op.channels.rest as { reason: string }).reason).toContain('/api/pages/:rootId/*');
    // 2.1.26 — the record's `powody.rest`: M02's raw read for the editor, the file byte for byte with `hash`.
    expect((op.channels.rest as { reason: string }).reason).toContain('M02');
    expect((op.channels.rest as { reason: string }).reason).toContain('`hash`');
  });

  /**
   * 0.2.59 — `get_page_outline` is the one M39 read that does NOT claim parity, and
   * the gap is a decision rather than a backlog item.
   *
   * Asserted as its own case rather than dropped from the list above, because
   * "absent from a roster" and "declared n/a with a reason" are different states and
   * only the second is a contract. The reason has to be there too: an empty `n/a` is
   * exactly the unexplained gap the four-channel rule exists to prevent.
   */
  it('`get_page_outline` declares its REST gap rather than claiming parity', () => {
    const op = CATALOG.require('get_page_outline');
    expect(op.channels.internal.kind).toBe('direct');
    expect(op.channels.cli.kind).toBe('direct');
    expect(op.channels.mcp.kind).toBe('direct');
    expect(op.channels.rest.kind).toBe('na');
    expect(op.channels.rest).toHaveProperty('reason');
    // `GET /api/sections` is the route the reason is ABOUT — it stays M06's own
    // semantics, and the cell says so rather than pointing at a route to build.
    expect((op.channels.rest as { reason: string }).reason).toContain('/api/sections');
  });

  /**
   * `find_references` used to declare `ENTITY_NOT_FOUND` / `MISSING_TARGET`,
   * and neither is reachable: `discovery/ops/references.ts` raises
   * `INVALID_ARGUMENT` for a missing `target`, a missing page key or an
   * unknown `rootId`, and `INVALID_TYPE` for an unknown entity type. A target
   * nothing cites is a SUCCESS with `total: 0`, which is why no `*_NOT_FOUND`
   * belongs on this operation at all — declaring one tells an agent to expect
   * an error where it will get an empty list.
   */
  it('declares only the error codes find_references can actually raise', () => {
    const op = CATALOG.get('find_references');
    expect(op).toBeDefined();
    // Exactly the shared read-operation set — no per-operation additions.
    // 0.2.77 — `INDEX_STALE` joins that shared set: `find_references` reads the
    // M14 link map, and its backref answer is exactly the kind a caller writes
    // against (rename-sync rewrites every page in it).
    // 0.2.86 — `INDEX_NOT_MATERIALIZED` is internal-only and no longer declared.
    expect([...op!.errorCodes].sort()).toEqual([
      'INDEX_STALE',
      'INVALID_ARGUMENT',
      'INVALID_TYPE',
    ]);
    expect(op!.errorCodes).not.toContain('ENTITY_NOT_FOUND');
    expect(op!.errorCodes).not.toContain('MISSING_TARGET');
  });

  /**
   * 2.1.26 — the record `get-field-content` (M39): one generic core operation,
   * rendered `direct` on all four channels. Its internal rendering is the
   * `entity-tools` tool (`entity-tools-get-field-content`), its mcp rendering
   * the external reader's own tool (`c4s-reader-get-field-content`); `cli` is
   * `c4s get-field-content`. `kodyBledow` is declared once each.
   */
  it('[entity:get-field-content] get_field_content is declared as its record says: project, direct on every channel, no effects, idempotent, four codes once each', () => {
    const op = CATALOG.require('get_field_content');
    expect(op.name).toBe('get_field_content');
    expect(op.scope).toBe('project');
    expect(op.mediation).toBe('direct');
    expect(op.opClass).toBe('read');
    for (const channel of CHANNELS) expect(op.channels[channel].kind, channel).toBe('direct');
    expect(op.sideEffects).toEqual(['none']);
    expect(op.idempotent).toBe(true);
    // `opisTresci: n/d` — no file is written, so no content-input mode is declared.
    expect(op.contentInput).toBeUndefined();
    // Addressing `(type, slug, field)`, one field of one entity per call.
    expect(Object.keys(op.inputSchema).sort()).toEqual(['field', 'slug', 'type']);
    // `error-code-once`: the list carries no duplicate…
    expect(new Set(op.errorCodes).size).toBe(op.errorCodes.length);
    // …and is exactly the record's `kodyBledow`.
    expect([...op.errorCodes].sort()).toEqual(['ENTITY_NOT_FOUND', 'INDEX_STALE', 'INVALID_ARGUMENT', 'INVALID_TYPE']);

    // `narzedzia`: each agentic `direct` cell names a registered tool.
    const mcpDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../mcp');
    const toolsIn = (file: string): string[] =>
      Array.from(fs.readFileSync(path.join(mcpDir, file), 'utf-8').matchAll(/\b(?:mcpTool|op)\(\s*\n?\s*'([a-z_]+)'/g)).map(
        (m) => m[1]!,
      );
    // internal → entity-tools-get-field-content; mcp → c4s-reader-get-field-content. One each.
    expect(toolsIn('entity-tools.ts').filter((n) => n === 'get_field_content')).toHaveLength(1);
    expect(toolsIn('c4s-reader.ts').filter((n) => n === 'get_field_content')).toHaveLength(1);
  });

  it('every declared opClass is one the profile registry knows', () => {
    for (const op of CATALOG.list()) {
      expect(KNOWN_OPERATION_CLASSES).toContain(op.opClass);
    }
  });

  it('`list_projects` is workspace-scoped and declares its REST gap rather than claiming parity', () => {
    const op = CATALOG.require('list_projects');
    expect(op.scope).toBe('workspace');
    expect(op.channels.rest.kind).toBe('na');
  });

  it('`create_patch` is not idempotent — two filings of one drift are two files', () => {
    expect(CATALOG.require('create_patch').idempotent).toBe(false);
  });

  it('`abort_turn` IS idempotent — aborting a thread with no live turn is a no-op', () => {
    expect(CATALOG.require('abort_turn').idempotent).toBe(true);
  });
});

describe('context profiles', () => {
  it('an external connection with no profile named gets `chat`', async () => {
    const { DEFAULT_PROFILE } = await import('./profiles.js');
    expect(DEFAULT_PROFILE).toBe('chat');
  });

  it('[ac:ac-profil-patch-w-kanale-mcp-daje-ten-sa] `patch` admits exactly what `chat` admits', () => {
    expect([...PROFILES.patch.operationClasses].sort()).toEqual([...PROFILES.chat.operationClasses].sort());
  });

  it('[ac:ac-profil-ask-w-kanale-mcp-renderuje-sie] `ask` admits read and plan, and nothing that writes or delegates', () => {
    expect(profileAdmits('ask', CATALOG.require('get_page'))).toBe(true);
    expect(profileAdmits('ask', CATALOG.require('update_plan'))).toBe(true);
    expect(profileAdmits('ask', CATALOG.require('create_entities'))).toBe(false);
    expect(profileAdmits('ask', CATALOG.require('tag_entity'))).toBe(false);
    // The recursion guard is a property of the profile, so no channel routes around it.
    expect(profileAdmits('ask', CATALOG.require('ask'))).toBe(false);
    expect(profileAdmits('ask', CATALOG.require('abort_turn'))).toBe(false);
  });

  it('[ac:ac-profil-brief-w-kanale-mcp-renderuje-s] `brief` admits brief artifacts and reads, not spec writes', () => {
    expect(profileAdmits('brief', CATALOG.require('get_brief'))).toBe(true);
    expect(profileAdmits('brief', CATALOG.require('create_patch'))).toBe(true);
    expect(profileAdmits('brief', CATALOG.require('list_entities'))).toBe(true);
    expect(profileAdmits('brief', CATALOG.require('create_entities'))).toBe(false);
  });

  it('the mounted server set is DERIVED from the admitted classes, not written beside them', () => {
    // These four reproduce the pre-0.2.13 hand-written registry rows exactly —
    // the derivation is behaviour-preserving, which is what makes it safe.
    // 2.1.9: `specSkillTools` is DECLARED per profile rather than derived
    // (M44 `3f5ej79s`); 2.1.18: so is `transagentTools`.
    expect(mcpServerSetForProfile('chat')).toEqual({
      pluginServers: 'all',
      planTools: true,
      briefTools: false,
      c4sTools: true,
      transagentTools: true,
      specSkillTools: true,
    });
    expect(mcpServerSetForProfile('brief')).toEqual({
      pluginServers: 'release-only',
      planTools: false,
      briefTools: true,
      c4sTools: false,
      transagentTools: false,
      specSkillTools: false,
    });
    // 2.1.18 (M44 `3f5ej79s`): `patch` is `chat`'s set WITHOUT transagent-tools —
    // declared per profile, so admitting the `turn` class does not mount it.
    expect(mcpServerSetForProfile('patch')).toEqual({ ...mcpServerSetForProfile('chat'), transagentTools: false });
    expect(mcpServerSetForProfile('ask')).toEqual({
      pluginServers: 'all',
      planTools: true,
      briefTools: false,
      c4sTools: false,
      transagentTools: false,
      specSkillTools: false,
    });
  });

  it('`brief` is the profile that forces an explicit brief-addressing parameter', () => {
    expect(PROFILES.brief.requiresExplicitBriefTarget).toBe(true);
    for (const p of ['chat', 'ask', 'patch'] as const) {
      expect(PROFILES[p].requiresExplicitBriefTarget).toBe(false);
    }
  });
});

describe('idempotence declarations', () => {
  /**
   * 0.2.86 — this row said `true` while the handler said otherwise, and the
   * declaration is what a caller plans a retry against.
   */
  it('delete_entities is NOT idempotent — an absent slug fails its item', () => {
    expect(CATALOG.require('delete_entities').idempotent).toBe(false);
    expect(CATALOG.require('delete_entities').summary).toMatch(/brokenReferences/);
    // Its neighbours are unaffected: an update of an existing row is a no-op
    // when nothing changed, a create always conflicts on a duplicate slug.
    expect(CATALOG.require('update_entities').idempotent).toBe(true);
    expect(CATALOG.require('create_entities').idempotent).toBe(false);
  });
});

describe('the profile gate', () => {
  it('[ac:ac-operacja-spoza-profilu-polaczenia-nie] withholds the entity write tools from `ask` — the peer that used to get them', () => {
    // The real entity-tools surface. Before 0.2.13 `ask` was handed all seven and
    // held back only by forced plan mode, which does not apply to MCP.
    const entityTools = [
      'create_entities',
      'get_entities',
      'update_entities',
      'delete_entities',
      'list_entities',
      'search_entities',
      'describe_entity_type',
    ].map((name) => ({ name, description: '', inputSchema: {}, handler: async () => ({}) }));

    expect(withheldTools('ask', entityTools).sort()).toEqual([
      'create_entities',
      'delete_entities',
      'update_entities',
    ]);
    // `chat` loses nothing.
    expect(withheldTools('chat', entityTools)).toEqual([]);
  });

  it('passes through an undeclared tool on a HOST-owned server', () => {
    // Declaring an operation must be what NARROWS access, never what accidentally
    // grants it — so an undeclared name on a surface this repo ships stays
    // governed by the coarse server gate.
    //
    // `runTransagent` is the TOOL name, and stays undeclared on purpose: 0.2.15
    // declares the OPERATION as `run_turn` and records the tool as its rendering
    // in the `via` cell, rather than renaming either side to match the other.
    expect(CATALOG.has('runTransagent')).toBe(false);
    expect(toolAdmittedByProfile('brief', 'runTransagent')).toBe(true);
  });

  it('declares run_turn, whose MCP rendering is the differently-named runTransagent', () => {
    /**
     * 0.2.15. The spec has always called this operation `run_turn`; the code has
     * always called its one rendering `runTransagent`, and the catalog knew
     * neither — so the gate took the permissive branch for it, which makes an
     * omission indistinguishable from a decision. The `via` cell is where the
     * naming gap is recorded instead of being spread across two repositories.
     */
    const row = CATALOG.require('run_turn');
    expect(row.opClass).toBe('turn');
    expect(row.idempotent).toBe(false);
    expect(row.channels.mcp).toMatchObject({ kind: 'via', operation: 'runTransagent' });
    // 0.2.87 (M46): internally a turn run is reached only by spawning a child thread.
    expect(row.channels.internal).toMatchObject({ kind: 'via', operation: 'spawn_child_turn' });
    const spawn = CATALOG.require('spawn_child_turn');
    expect(spawn.mediation).toBe('agent-mediated');
    expect(spawn.channels.internal.kind).toBe('direct');
    expect([spawn.channels.cli.kind, spawn.channels.mcp.kind, spawn.channels.rest.kind]).toEqual(['na', 'na', 'na']);
    expect(spawn.sideEffects).toEqual(['file', 'db', 'ui-notify']);
    // 0.2.107: a child stopped by its own idle clock (or its parent's) ends IDLE_TIMEOUT.
    expect(spawn.errorCodes).toEqual(expect.arrayContaining(['TIMEOUT', 'IDLE_TIMEOUT', 'ABORTED']));
    // 0.2.111: a continuation founds a new row too — never idempotent — and is refused
    // (before any row exists) while its session is in flight or its config changed.
    expect(spawn.idempotent).toBe(false);
    expect(spawn.errorCodes).toEqual(expect.arrayContaining(['STREAM_IN_PROGRESS', 'RESUME_CONFIG_LOCKED']));
    // No CLI and no REST door: a child turn is spawned from inside a turn.
    expect(row.channels.cli.kind).toBe('na');
    expect(row.channels.rest.kind).toBe('na');
    // The guard is stateful, not hash-based — there is no expectedHash for
    // "a turn is already running".
    expect(row.errorCodes).toContain('STREAM_IN_PROGRESS');
  });

  it('withholds the release WRITES from every read-only profile', () => {
    /**
     * `release-tools` is host-owned, so the pass-through above applied to it —
     * and it mounts on `ask` (`pluginServers: 'all'`) and on `brief`
     * (`BRIEF_ALLOWED_PLUGIN_MCP`), the two profiles built to be unable to
     * mutate the specification. `release_create` stamps every unreleased
     * version row and makes a git commit; `release_update` renames the latest
     * release and can sweep the queue into it. Both were reachable from a
     * consulted peer and from a brief-authoring turn.
     *
     * That the gate's default was permissive here is not the bug — the reason
     * for it is stated in `profile-gate.ts` and holds. The bug is that nobody
     * had written the row, which is precisely the condition the default assumes
     * is temporary.
     *
     * 0.2.13 makes it urgent rather than theoretical: the MCP config entry
     * claude4spec generates for every project asks for `?profile=ask`, so that
     * consulted peer is now every editor the user opens.
     */
    const releaseTools = [
      'release_list',
      'release_show',
      'release_diff',
      'release_create',
      'release_update',
    ].map((name) => ({ name, description: '', inputSchema: {}, handler: async () => ({}) }));

    for (const profile of ['ask', 'brief'] as const) {
      expect(withheldTools(profile, releaseTools).sort(), profile).toEqual([
        'release_create',
        'release_update',
      ]);
    }
    // The readers survive — they are what these profiles mount release-tools for.
    expect(withheldTools('chat', releaseTools)).toEqual([]);
    expect(withheldTools('patch', releaseTools)).toEqual([]);
  });

  it('[ac:ac-crud-stron-dziala-przez-ui-i-wbudowane-n] withholds the whole page write path from a read-only profile', () => {
    /**
     * 0.2.13 item 28. `page-tools` is host-owned, so without these rows the
     * gate's permissive default would hand a consulted peer — and, through the
     * generated MCP config entry, every editor the user opens — the ability to
     * overwrite any page in the specification it was asked a question about.
     *
     * The whole server, not a subset: unlike `release-tools`, every operation on
     * it writes, so `ask` and `brief` are left with nothing and the server is
     * dropped rather than mounted empty.
     */
    const pageTools = ['create_page', 'update_page', 'delete_page', 'move_page', 'update_sections'].map((name) => ({
      name,
      description: '',
      inputSchema: {},
      handler: async () => ({}),
    }));

    for (const profile of ['ask', 'brief'] as const) {
      expect(withheldTools(profile, pageTools).sort(), profile).toEqual([
        'create_page',
        'delete_page',
        'move_page',
        'update_page',
        'update_sections',
      ]);
    }
    // The profiles that author a specification keep all five.
    expect(withheldTools('chat', pageTools)).toEqual([]);
    expect(withheldTools('patch', pageTools)).toEqual([]);
  });

  it('[ac:ac-operacja-spoza-profilu-polaczenia-nie] withholds a PLUGIN\'s declared write tools from `ask`', () => {
    // The real spreadsheet-tools surface. Six of these eight mutate a
    // specification, and before they were catalogued the gate waved all eight
    // through to a consulted peer.
    const spreadsheet = [
      'get_overview',
      'get_range',
      'set_cell',
      'set_range',
      'insert_row',
      'insert_column',
      'delete_row',
      'delete_column',
    ].map((name) => ({ name, description: '', inputSchema: {}, handler: async () => ({}) }));

    expect(withheldTools('ask', spreadsheet, { plugin: true }).sort()).toEqual([
      'delete_column',
      'delete_row',
      'insert_column',
      'insert_row',
      'set_cell',
      'set_range',
    ]);
    // The reads survive — cataloguing them is what keeps the fail-closed rule
    // from swallowing the whole plugin surface.
    expect(toolAdmittedByProfile('ask', 'get_overview', { plugin: true })).toBe(true);
    expect(toolAdmittedByProfile('ask', 'get_range', { plugin: true })).toBe(true);
    // `chat` admits writes, so it loses nothing.
    expect(withheldTools('chat', spreadsheet, { plugin: true })).toEqual([]);
  });

  it('fails CLOSED on an UNDECLARED plugin tool for a profile that admits no writes', () => {
    // The case the catalog cannot enumerate in advance: a plugin published
    // tomorrow. Guessing "probably a read" is what made this a hole.
    const unknown = [{ name: 'obliterate_everything', description: '', inputSchema: {}, handler: async () => ({}) }];
    expect(withheldTools('ask', unknown, { plugin: true })).toEqual(['obliterate_everything']);
    expect(withheldTools('brief', unknown, { plugin: true })).toEqual(['obliterate_everything']);
    // …but a write-admitting profile still gets it, and the same tool on a
    // host-owned server is still passed through.
    expect(withheldTools('chat', unknown, { plugin: true })).toEqual([]);
    expect(withheldTools('ask', unknown)).toEqual([]);
  });

  it('derives plugin server names the same way the host mounts them', () => {
    expect([...pluginServerNamesFor(['spreadsheet', 'diagram'])].sort()).toEqual([
      'diagram-tools',
      'spreadsheet-tools',
    ]);
  });
});

describe('envelope and error taxonomy', () => {
  it('serializes success into a single text block', () => {
    expect(toolSuccess({ a: 1 })).toEqual({ content: [{ type: 'text', text: '{"a":1}' }] });
  });

  it('marks errors with isError and carries the code inside the payload', () => {
    const env = toolError('NOT_FOUND', 'no such page', 'try list_pages');
    expect(env.isError).toBe(true);
    expect(JSON.parse(env.content[0]!.text)).toEqual({
      error: 'no such page',
      code: 'NOT_FOUND',
      hint: 'try list_pages',
    });
  });

  it('maps the shared codes onto HTTP without inventing new ones', () => {
    expect(httpStatusForCode('INVALID_TYPE')).toBe(404);
    expect(httpStatusForCode('BRIEF_NOT_FOUND')).toBe(404);
    expect(httpStatusForCode('THREAD_NOT_FOUND')).toBe(404);
    expect(httpStatusForCode('PATCH_WRITE_FAILED')).toBe(500);
    expect(httpStatusForCode('VALIDATION')).toBe(400);
    // Unknown ⇒ client error, never a 500 the caller cannot act on.
    expect(httpStatusForCode('SOMETHING_NOBODY_DECLARED')).toBe(400);
  });

  it('a thrown DomainError gets the same status as the tool proxy gives the same code', async () => {
    /**
     * The shared table's own comment claims "the two paths out of the same
     * failure now agree". They did not: `routes/errors.ts` read only
     * `STATUS_FOR_CODE`, so a `DomainError` carrying a code that lives ONLY in
     * the discovery table flattened to 400 while the identical code raised
     * through `entities-router`'s proxy — which does call `httpStatusForCode` —
     * answered 404/409/503. And `DomainError('INTERNAL')`, what
     * `decodeToolFailure` yields for a crashed plugin handler, reported a server
     * fault as a malformed request, so a client's 4xx/5xx branch did the wrong
     * thing twice: no retry, no escalation.
     */
    const express = (await import('express')).default;
    const request = (await import('supertest')).default;
    const { errorHandler } = await import('../routes/errors.js');
    const { DomainError } = await import('../services/tags.js');

    const app = express();
    app.get('/boom/:code', (req, _res, next) => next(new DomainError(req.params.code!, 'x')));
    app.use(errorHandler);

    for (const [code, status] of [
      ['ENTITY_NOT_FOUND', 404],
      ['PAGE_NOT_FOUND', 404],
      ['INVALID_TYPE', 404],
      ['INTERNAL', 500],
      ['VALIDATION', 400],
    ] as const) {
      const res = await request(app).get(`/boom/${code}`);
      expect(res.status, code).toBe(status);
      expect(res.status, code).toBe(httpStatusForCode(code));
    }

    /**
     * The one code the shared resolver must NOT decide here. Dispatch in
     * `routes/errors.ts` is by error CLASS on purpose: `SECTION_NOT_FOUND` is 404
     * when the discovery core cannot ADDRESS a section and 400 when a domain
     * write is malformed about one. `httpStatusForCode` prefers the discovery
     * table, so handing this branch to it wholesale would collapse the two.
     */
    expect((await request(app).get('/boom/SECTION_NOT_FOUND')).status).toBe(400);
    expect(httpStatusForCode('SECTION_NOT_FOUND')).toBe(404);
  });
});

/**
 * 2.1.26 — the fourteen M39/M19 read rows against their `spec-operation` records
 * (`check-consistency` … `search-pages`): canonical name, scope, mediation,
 * the four channel cells (an `n/a` carrying the record's `powody` entry), no side
 * effects (`efekty: brak`), idempotent (`idempotencja: tak`), no content input
 * (`opisTresci: n/d`), `errorCodes` exactly the record's `kodyBledow` (each once;
 * `n/d` is the empty list), and `renderings` exactly its `narzedzia` — every
 * named tool registered on its server, every agentic `direct` cell pointing at
 * one and no `n/a` cell pointing at any.
 */
describe('the M39 read rows as their 2.1.26 records declare them', () => {
  type Kind = 'direct' | 'na';
  interface ReadRecord {
    nazwa: string;
    zasieg: 'project' | 'workspace';
    mediacja: 'direct';
    channels: Record<ChannelName, Kind>;
    powody: Partial<Record<ChannelName, string>>;
    kodyBledow: string[];
    narzedzia: Partial<Record<'internal' | 'mcp', string[]>>;
  }

  /** The tools each server actually registers — built, not grepped. */
  const registered = new Map<string, Set<string>>([
    [
      'c4s-reader',
      new Set(
        createC4sReaderServer({ reader: null, discovery: null, db: null, projectDir: null, packageVersion: 'test' }).tools.map(
          (t) => t.name,
        ),
      ),
    ],
    [
      'reference-tools',
      new Set(createReferenceToolsServer({} as unknown as ReferenceToolsDeps).tools.map((t) => t.name)),
    ],
    ['entity-tools', new Set(buildEntityTools({} as unknown as EntityToolsDeps).map((t) => t.name))],
  ]);

  function expectRecordRow(record: ReadRecord): void {
    const op = CATALOG.require(record.nazwa);
    expect(op.name).toBe(record.nazwa);
    expect(op.scope).toBe(record.zasieg);
    expect(op.mediation).toBe(record.mediacja);
    expect(op.opClass).toBe('read');
    for (const channel of CHANNELS) {
      const cell = op.channels[channel];
      expect(cell.kind, `${record.nazwa}.${channel}`).toBe(record.channels[channel]);
      if (cell.kind === 'na') expect(cell.reason, `${record.nazwa}.${channel} reason`).toBe(record.powody[channel]);
    }
    expect(op.sideEffects).toEqual(['none']);
    expect(op.idempotent).toBe(true);
    expect(op.contentInput).toBeUndefined();
    // `error-code-once`, and exactly the record's subset of the taxonomy.
    expect(new Set(op.errorCodes).size).toBe(op.errorCodes.length);
    expect([...op.errorCodes].sort()).toEqual([...record.kodyBledow].sort());

    // `narzedzia` → `renderings`, as `<server>.<tool>` of each named mcp-tool record.
    const expected: Partial<Record<'internal' | 'mcp', string[]>> = {};
    for (const [channel, slugs] of Object.entries(record.narzedzia) as Array<['internal' | 'mcp', string[]]>) {
      expected[channel] = slugs.map((slug) => {
        const tool = READ_TOOL_RECORDS[slug];
        expect(tool, `mcp-tool record ${slug}`).toBeDefined();
        return `${tool!.server}.${tool!.name}`;
      });
    }
    expect(op.renderings ?? {}).toEqual(expected);
    for (const channel of ['internal', 'mcp'] as const) {
      const named = op.renderings?.[channel] ?? [];
      if (op.channels[channel].kind === 'direct') expect(named.length, `${record.nazwa}.${channel}`).toBeGreaterThan(0);
      else expect(named, `${record.nazwa}.${channel}`).toEqual([]);
      for (const rendering of named) {
        const [server, name] = rendering.split('.') as [string, string];
        expect(registered.get(server)?.has(name), rendering).toBe(true);
      }
    }
  }

  it('[entity:check-consistency] check_consistency: project, direct, channels internal direct/cli direct/mcp direct/rest direct, no effects, idempotent, codes INVALID_ARGUMENT', () => {
    expectRecordRow({
      nazwa: 'check_consistency',
      zasieg: 'project',
      mediacja: 'direct',
      channels: { internal: 'direct', cli: 'direct', mcp: 'direct', rest: 'direct' },
      powody: {},
      kodyBledow: ['INVALID_ARGUMENT'],
      narzedzia: { internal: ['reference-tools-check-consistency'], mcp: ['c4s-reader-check-consistency'] },
    });
  });

  it('[entity:describe-types] describe_types: project, direct, channels internal direct/cli direct/mcp direct/rest direct, no effects, idempotent, codes INVALID_TYPE', () => {
    expectRecordRow({
      nazwa: 'describe_types',
      zasieg: 'project',
      mediacja: 'direct',
      channels: { internal: 'direct', cli: 'direct', mcp: 'direct', rest: 'direct' },
      powody: {},
      kodyBledow: ['INVALID_TYPE'],
      narzedzia: { internal: ['entity-tools-describe-entity-type'], mcp: ['c4s-reader-describe-types', 'entity-tools-describe-entity-type'] },
    });
  });

  it('[entity:find-references] find_references: project, direct, channels internal direct/cli direct/mcp direct/rest direct, no effects, idempotent, codes INVALID_ARGUMENT, INVALID_TYPE, INDEX_STALE', () => {
    expectRecordRow({
      nazwa: 'find_references',
      zasieg: 'project',
      mediacja: 'direct',
      channels: { internal: 'direct', cli: 'direct', mcp: 'direct', rest: 'direct' },
      powody: {},
      kodyBledow: ['INVALID_ARGUMENT', 'INVALID_TYPE', 'INDEX_STALE'],
      narzedzia: { internal: ['reference-tools-find-references'], mcp: ['c4s-reader-find-references'] },
    });
  });

  it('[entity:get-entities] get_entities: project, direct, channels internal direct/cli direct/mcp direct/rest direct, no effects, idempotent, codes INVALID_TYPE, INVALID_ARGUMENT, INDEX_STALE', () => {
    expectRecordRow({
      nazwa: 'get_entities',
      zasieg: 'project',
      mediacja: 'direct',
      channels: { internal: 'direct', cli: 'direct', mcp: 'direct', rest: 'direct' },
      powody: {},
      kodyBledow: ['INVALID_TYPE', 'INVALID_ARGUMENT', 'INDEX_STALE'],
      narzedzia: { internal: ['entity-tools-get-entities'], mcp: ['c4s-reader-get-entities'] },
    });
  });

  it('[entity:get-page] get_page: project, direct, channels internal direct/cli direct/mcp direct/rest na, no effects, idempotent, codes PAGE_NOT_FOUND, INVALID_ARGUMENT', () => {
    expectRecordRow({
      nazwa: 'get_page',
      zasieg: 'project',
      mediacja: 'direct',
      channels: { internal: 'direct', cli: 'direct', mcp: 'direct', rest: 'na' },
      powody: { rest: 'odczyt pliku dla edytora należy do M02: `GET /api/pages/:rootId/*` wydaje surowy plik bajt w bajt z `hash`, a nie strukturę tej operacji, więc renderowaniem `get_page` nie jest' },
      kodyBledow: ['PAGE_NOT_FOUND', 'INVALID_ARGUMENT'],
      narzedzia: { internal: ['reference-tools-get-page'], mcp: ['c4s-reader-get-page'] },
    });
  });

  it('[entity:get-page-outline] get_page_outline: project, direct, channels internal direct/cli direct/mcp direct/rest na, no effects, idempotent, codes PAGE_NOT_FOUND, INVALID_ARGUMENT, INDEX_STALE', () => {
    expectRecordRow({
      nazwa: 'get_page_outline',
      zasieg: 'project',
      mediacja: 'direct',
      channels: { internal: 'direct', cli: 'direct', mcp: 'direct', rest: 'na' },
      powody: { rest: '`GET /api/sections` nie jest renderowaniem tej operacji: bez `pagePath` zwraca płaską listę globalną przez wszystkie strony, a outline jest z definicji kluczowany jedną stroną. Doprowadzenie trasy do parytetu jest osobną zmianą o własnym uzasadnieniu' },
      kodyBledow: ['PAGE_NOT_FOUND', 'INVALID_ARGUMENT', 'INDEX_STALE'],
      narzedzia: { internal: ['reference-tools-get-page-outline'], mcp: ['c4s-reader-get-page-outline'] },
    });
  });

  it('[entity:get-sections] get_sections: project, direct, channels internal direct/cli direct/mcp direct/rest direct, no effects, idempotent, codes SECTION_NOT_FOUND, PAGE_NOT_FOUND, INVALID_ARGUMENT, INDEX_STALE', () => {
    expectRecordRow({
      nazwa: 'get_sections',
      zasieg: 'project',
      mediacja: 'direct',
      channels: { internal: 'direct', cli: 'direct', mcp: 'direct', rest: 'direct' },
      powody: {},
      kodyBledow: ['SECTION_NOT_FOUND', 'PAGE_NOT_FOUND', 'INVALID_ARGUMENT', 'INDEX_STALE'],
      narzedzia: { internal: ['reference-tools-get-sections'], mcp: ['c4s-reader-get-sections'] },
    });
  });

  it('[entity:list-entities] list_entities: project, direct, channels internal direct/cli direct/mcp direct/rest direct, no effects, idempotent, codes INVALID_TYPE, INVALID_ARGUMENT, INDEX_STALE', () => {
    expectRecordRow({
      nazwa: 'list_entities',
      zasieg: 'project',
      mediacja: 'direct',
      channels: { internal: 'direct', cli: 'direct', mcp: 'direct', rest: 'direct' },
      powody: {},
      kodyBledow: ['INVALID_TYPE', 'INVALID_ARGUMENT', 'INDEX_STALE'],
      narzedzia: { internal: ['entity-tools-list-entities'], mcp: ['c4s-reader-list-entities'] },
    });
  });

  it('[entity:list-pages] list_pages: project, direct, channels internal direct/cli direct/mcp direct/rest direct, no effects, idempotent, codes INVALID_ARGUMENT', () => {
    expectRecordRow({
      nazwa: 'list_pages',
      zasieg: 'project',
      mediacja: 'direct',
      channels: { internal: 'direct', cli: 'direct', mcp: 'direct', rest: 'direct' },
      powody: {},
      kodyBledow: ['INVALID_ARGUMENT'],
      narzedzia: { internal: ['reference-tools-list-pages'], mcp: ['c4s-reader-list-pages'] },
    });
  });

  it('[entity:list-tags] list_tags: project, direct, channels internal direct/cli direct/mcp direct/rest direct, no effects, idempotent, codes INVALID_ARGUMENT, INDEX_STALE', () => {
    expectRecordRow({
      nazwa: 'list_tags',
      zasieg: 'project',
      mediacja: 'direct',
      channels: { internal: 'direct', cli: 'direct', mcp: 'direct', rest: 'direct' },
      powody: {},
      kodyBledow: ['INVALID_ARGUMENT', 'INDEX_STALE'],
      narzedzia: { internal: ['reference-tools-list-tags'], mcp: ['c4s-reader-list-tags'] },
    });
  });

  it('[entity:overview] overview: project, direct, channels internal na/cli direct/mcp direct/rest direct, no effects, idempotent, codes none', () => {
    expectRecordRow({
      nazwa: 'overview',
      zasieg: 'project',
      mediacja: 'direct',
      channels: { internal: 'na', cli: 'direct', mcp: 'direct', rest: 'direct' },
      powody: { internal: 'kanał wewnętrzny nie ma renderowania tej operacji i nie potrzebuje go: prompt niesie rooty, aktywne typy i tooling statycznie, a liczności rekordów odświeża `list_entities({ mode: \'count\' })`' },
      kodyBledow: [],
      narzedzia: { mcp: ['c4s-reader-overview'] },
    });
  });

  it('[entity:resolve-identity] resolve_identity: project, direct, channels internal direct/cli direct/mcp direct/rest direct, no effects, idempotent, codes INVALID_TYPE, INDEX_STALE', () => {
    expectRecordRow({
      nazwa: 'resolve_identity',
      zasieg: 'project',
      mediacja: 'direct',
      channels: { internal: 'direct', cli: 'direct', mcp: 'direct', rest: 'direct' },
      powody: {},
      kodyBledow: ['INVALID_TYPE', 'INDEX_STALE'],
      narzedzia: { internal: ['entity-tools-resolve-identity'], mcp: ['c4s-reader-resolve-identity'] },
    });
  });

  it('[entity:search-entities] search_entities: project, direct, channels internal direct/cli direct/mcp direct/rest direct, no effects, idempotent, codes INVALID_TYPE, INVALID_ARGUMENT, SEARCH_BUDGET_EXCEEDED, INDEX_STALE', () => {
    expectRecordRow({
      nazwa: 'search_entities',
      zasieg: 'project',
      mediacja: 'direct',
      channels: { internal: 'direct', cli: 'direct', mcp: 'direct', rest: 'direct' },
      powody: {},
      kodyBledow: ['INVALID_TYPE', 'INVALID_ARGUMENT', 'SEARCH_BUDGET_EXCEEDED', 'INDEX_STALE'],
      narzedzia: { internal: ['entity-tools-search-entities'], mcp: ['c4s-reader-search-entities'] },
    });
    // Addressed by the query plus `type` — `type` is the one required input.
    const shape = z.object(CATALOG.require('search_entities').inputSchema as z.ZodRawShape);
    expect(shape.safeParse({ query: 'x' }).success).toBe(false);
    expect(shape.safeParse({ type: 'ac', query: 'x', filters: { status: ['active'] } }).success).toBe(true);
  });

  it('[entity:search-pages] search_pages: project, direct, channels internal direct/cli direct/mcp direct/rest direct, no effects, idempotent, codes INVALID_ARGUMENT, INDEX_STALE, SEARCH_BUDGET_EXCEEDED', () => {
    expectRecordRow({
      nazwa: 'search_pages',
      zasieg: 'project',
      mediacja: 'direct',
      channels: { internal: 'direct', cli: 'direct', mcp: 'direct', rest: 'direct' },
      powody: {},
      kodyBledow: ['INVALID_ARGUMENT', 'INDEX_STALE', 'SEARCH_BUDGET_EXCEEDED'],
      narzedzia: { internal: ['reference-tools-search-pages'], mcp: ['c4s-reader-search-pages'] },
    });
    // Addressed by the pattern plus a path filter — no input is required by the schema.
    const shape = z.object(CATALOG.require('search_pages').inputSchema as z.ZodRawShape);
    expect(shape.safeParse({}).success).toBe(true);
    expect(shape.safeParse({ regex: 'x', rootId: 'pages', pathInclude: '^modules/', pathExclude: 'drift' }).success).toBe(true);
  });
});

/**
 * 2.1.26 — the M13 mutation rows as their `spec-operation` records declare them
 * (`create-entities`, `update-entities`, `delete-entities`, `link-dto`,
 * `unlink-dto`, `restore-entity-version`): scope `project`, the record's
 * mediation and four channel cells (a `via` / `n/a` cell carrying the record's
 * `powody` verbatim), effects file/db/ui-notify, idempotence, content input
 * (`dosłowny` → `literal`, `n/d` → `n/a`), `errorCodes` exactly the record's
 * `kodyBledow` (each once), and `renderings` exactly its `narzedzia` — every named
 * tool registered on its server, every agentic `direct` cell pointing at one and
 * no `n/a` cell pointing at any.
 */
describe('the M13 mutation rows as their 2.1.26 records declare them', () => {
  type Cell = { kind: 'direct' } | { kind: 'via'; operation: string; reason: string } | { kind: 'na'; reason: string };
  interface WriteRecord {
    nazwa: string;
    mediacja: 'direct' | 'human-mediated';
    channels: Record<ChannelName, Cell>;
    idempotencja: boolean;
    opisTresci: 'literal' | 'n/a';
    kodyBledow: string[];
    narzedzia: Partial<Record<'internal' | 'mcp', string[]>>;
  }
  const D: Cell = { kind: 'direct' };

  const registered = new Map<string, Set<string>>([
    ['entity-tools', new Set(buildEntityTools({} as unknown as EntityToolsDeps).map((t) => t.name))],
    [
      'endpoint-tools',
      new Set(
        (
          createEndpointToolsServer({ links: {} as unknown as LinkDtoDeps }) as unknown as { tools: ReadonlyArray<{ name: string }> }
        ).tools.map((t) => t.name),
      ),
    ],
  ]);

  function expectRecordRow(record: WriteRecord): void {
    const op = CATALOG.require(record.nazwa);
    expect(op.name).toBe(record.nazwa);
    expect(op.scope).toBe('project');
    expect(op.mediation).toBe(record.mediacja);
    expect(op.opClass).toBe('write');
    for (const channel of CHANNELS) {
      expect(op.channels[channel], `${record.nazwa}.${channel}`).toEqual(record.channels[channel]);
    }
    expect(op.sideEffects).toEqual(['file', 'db', 'ui-notify']);
    expect(op.idempotent).toBe(record.idempotencja);
    expect(op.contentInput).toBe(record.opisTresci);
    expect(new Set(op.errorCodes).size).toBe(op.errorCodes.length);
    expect([...op.errorCodes].sort()).toEqual([...record.kodyBledow].sort());

    const expected: Partial<Record<'internal' | 'mcp', string[]>> = {};
    for (const [channel, slugs] of Object.entries(record.narzedzia) as Array<['internal' | 'mcp', string[]]>) {
      expected[channel] = slugs.map((slug) => {
        const tool = WRITE_TOOL_RECORDS[slug];
        expect(tool, `mcp-tool record ${slug}`).toBeDefined();
        return `${tool!.server}.${tool!.name}`;
      });
    }
    expect(op.renderings ?? {}).toEqual(expected);
    for (const channel of ['internal', 'mcp'] as const) {
      const named = op.renderings?.[channel] ?? [];
      if (op.channels[channel].kind === 'direct') expect(named.length, `${record.nazwa}.${channel}`).toBeGreaterThan(0);
      else expect(named, `${record.nazwa}.${channel}`).toEqual([]);
      for (const rendering of named) {
        const [server, name] = rendering.split('.') as [string, string];
        expect(registered.get(server)?.has(name), rendering).toBe(true);
      }
    }
  }

  it('[entity:create-entities] create_entities: project, direct, all four channels direct, file/db/ui-notify, not idempotent, literal, codes INVALID_TYPE, SLUG_CONFLICT, VALIDATION, rendered by entity-tools · create_entities', () => {
    expectRecordRow({
      nazwa: 'create_entities',
      mediacja: 'direct',
      channels: { internal: D, cli: D, mcp: D, rest: D },
      idempotencja: false,
      opisTresci: 'literal',
      kodyBledow: ['INVALID_TYPE', 'SLUG_CONFLICT', 'VALIDATION'],
      narzedzia: { internal: ['entity-tools-create-entities'], mcp: ['entity-tools-create-entities'] },
    });
  });

  it('[entity:update-entities] update_entities: project, direct, all four channels direct, file/db/ui-notify, idempotent, literal, codes INVALID_TYPE, ENTITY_NOT_FOUND, VALIDATION, rendered by entity-tools · update_entities, addressed by (type, slug)', () => {
    expectRecordRow({
      nazwa: 'update_entities',
      mediacja: 'direct',
      channels: { internal: D, cli: D, mcp: D, rest: D },
      idempotencja: true,
      opisTresci: 'literal',
      kodyBledow: ['INVALID_TYPE', 'ENTITY_NOT_FOUND', 'VALIDATION'],
      narzedzia: { internal: ['entity-tools-update-entities'], mcp: ['entity-tools-update-entities'] },
    });
    const shape = z.object(CATALOG.require('update_entities').inputSchema as z.ZodRawShape);
    expect(shape.safeParse({ type: 'ac', updates: [{ slug: 'a', data: { title: 'x' }, newSlug: 'b' }] }).success).toBe(true);
    expect(shape.safeParse({ type: 'ac', updates: [{ data: { title: 'x' } }] }).success).toBe(false);
  });

  it('[entity:delete-entities] delete_entities: project, direct, all four channels direct, file/db/ui-notify, not idempotent, no content input, codes INVALID_TYPE, ENTITY_NOT_FOUND, VALIDATION, rendered by entity-tools · delete_entities', () => {
    expectRecordRow({
      nazwa: 'delete_entities',
      mediacja: 'direct',
      channels: { internal: D, cli: D, mcp: D, rest: D },
      idempotencja: false,
      opisTresci: 'n/a',
      kodyBledow: ['INVALID_TYPE', 'ENTITY_NOT_FOUND', 'VALIDATION'],
      narzedzia: { internal: ['entity-tools-delete-entities'], mcp: ['entity-tools-delete-entities'] },
    });
  });

  const viaProxy: Cell = {
    kind: 'via',
    operation: 'call_type_tool',
    reason: 'via `call_type_tool` — ogólne proxy hosta dla narzędzi typów; plugin nie wnosi własnego routera',
  };

  it('[entity:link-dto] link_dto: project, direct, internal/cli/mcp direct, rest via call_type_tool, file/db/ui-notify, idempotent, no content input, codes NOT_FOUND, VALIDATION, rendered by endpoint-tools · link_dto', () => {
    expectRecordRow({
      nazwa: 'link_dto',
      mediacja: 'direct',
      channels: { internal: D, cli: D, mcp: D, rest: viaProxy },
      idempotencja: true,
      opisTresci: 'n/a',
      kodyBledow: ['NOT_FOUND', 'VALIDATION'],
      narzedzia: { internal: ['endpoint-tools-link-dto'], mcp: ['endpoint-tools-link-dto'] },
    });
    // Addressed by the (endpoint, dto) pair with the relation role.
    const shape = z.object(CATALOG.require('link_dto').inputSchema as z.ZodRawShape);
    expect(shape.safeParse({ endpointSlug: 'e', dtoSlug: 'd', relation: 'response', statusCode: 200 }).success).toBe(true);
    expect(shape.safeParse({ endpointSlug: 'e', dtoSlug: 'd' }).success).toBe(false);
  });

  it('[entity:unlink-dto] unlink_dto: project, direct, internal/cli/mcp direct, rest via call_type_tool, file/db/ui-notify, idempotent, no content input, codes NOT_FOUND, VALIDATION, rendered by endpoint-tools · unlink_dto', () => {
    expectRecordRow({
      nazwa: 'unlink_dto',
      mediacja: 'direct',
      channels: { internal: D, cli: D, mcp: D, rest: viaProxy },
      idempotencja: true,
      opisTresci: 'n/a',
      kodyBledow: ['NOT_FOUND', 'VALIDATION'],
      narzedzia: { internal: ['endpoint-tools-unlink-dto'], mcp: ['endpoint-tools-unlink-dto'] },
    });
    // statusCode is optional: without it every binding of the pair in that relation goes.
    const shape = z.object(CATALOG.require('unlink_dto').inputSchema as z.ZodRawShape);
    expect(shape.safeParse({ endpointSlug: 'e', dtoSlug: 'd', relation: 'error' }).success).toBe(true);
  });

  it('[entity:restore-entity-version] restore_entity_version: project, human-mediated, internal/cli/mcp n/a with the record\'s reason, rest direct, file/db/ui-notify, idempotent, literal, codes INVALID_TYPE, VALIDATION, NOT_FOUND, INTERNAL, no renderings, addressed by (type, slug, version)', () => {
    const reason = 'akt user-initiated, bo cofa cudzą pracę; przegląd klasyfikacji otwarty';
    expectRecordRow({
      nazwa: 'restore_entity_version',
      mediacja: 'human-mediated',
      channels: { internal: { kind: 'na', reason }, cli: { kind: 'na', reason }, mcp: { kind: 'na', reason }, rest: D },
      idempotencja: true,
      opisTresci: 'literal',
      kodyBledow: ['INVALID_TYPE', 'VALIDATION', 'NOT_FOUND', 'INTERNAL'],
      narzedzia: {},
    });
    const shape = z.object(CATALOG.require('restore_entity_version').inputSchema as z.ZodRawShape);
    expect(shape.safeParse({ type: 'ac', slug: 'a', version: 3 }).success).toBe(true);
    expect(shape.safeParse({ type: 'ac', slug: 'a' }).success).toBe(false);
    // Not an agentic operation: no entity-tools tool carries its name.
    expect(registered.get('entity-tools')!.has('restore_entity_version')).toBe(false);
  });
});
