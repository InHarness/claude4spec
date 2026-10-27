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
  type ChannelCell,
  type ChannelName,
  type ContentInputMode,
  type OperationDeclaration,
} from './catalog.js';
import { FIELD_CLOSED_RULES, RULE_IDS, type RuleCitation, type RuleId } from './rules.js';
import { registerCoreOperations } from './core-operations.js';
import { KNOWN_OPERATION_CLASSES, PROFILES, mcpServerSetForProfile, profileAdmits } from './profiles.js';
import { pluginServerNamesFor, toolAdmittedByProfile, withheldTools } from './profile-gate.js';
import { toolError, toolSuccess } from './envelope.js';
import { STATUS_FOR_CODE, httpStatusForCode } from './error-codes.js';
import { OPERATION_RULES } from './operation-rules.js';
import { createC4sReaderServer } from '../mcp/c4s-reader.js';
import { createReferenceToolsServer, type ReferenceToolsDeps } from '../mcp/reference-tools.js';
import { buildEntityTools, type EntityToolsDeps } from '../mcp/entity-tools.js';
import { READ_TOOL_RECORDS } from '../../../tests/helpers/read-tool-records.js';
import { WRITE_TOOL_RECORDS } from '../../../tests/helpers/write-tool-records.js';
import { expectOperationMatchesRecord } from '../../../tests/helpers/operation-records.js';
import { TAG_TOOL_RECORDS } from '../../../tests/helpers/tag-tool-records.js';
import { CATALOGUE_TOOL_RECORDS, SPEC_OPERATION_RECORDS } from '../../../tests/helpers/spec-operation-records.js';
import { createEndpointToolsServer } from '../../../plugins/c4s-plugin-api-contracts/src/entity/endpoint/backend/mcp.js';
import { createPageToolsServer, type PageToolsDeps } from '../mcp/page-tools.js';
import type { LinkDtoDeps } from '../../../plugins/c4s-plugin-api-contracts/src/entity/endpoint/backend/link-dto.js';

/**
 * 2.1.43 — the `cli` reasons of the operations no `c4s` command renders, as the
 * records carry them (compared literally, backticks and Polish characters included).
 */
const CLI_NA_ENTITY = 'Komendy nie zaprojektowano: generyczne komendy encji `c4s` są wyłącznie odczytem.';
const CLI_NA_PAGES = 'Komendy nie zaprojektowano: rejestr komend `c4s` nie ma kontrybucji zapisu stron.';
const CLI_NA_TAGS = 'Komendy nie zaprojektowano: rejestr komend `c4s` nie ma kontrybucji zapisu tagów.';
const CLI_NA_SECTION = 'Komendy punktowej edycji sekcji nie zaprojektowano; rejestr komend jej nie zna.';

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

  /**
   * 2.1.26 — the criterion's wording: a row describing a CONTENT write says how
   * the caller describes the new content — `dosłowny`, `różnicowy` or `obydwa`
   * (`literal`, `diff`, `literal+diff`) — and never `n/d` (`n/a`). `n/a` stays
   * legal for a file write that takes no content from the caller (a delete, a
   * move, a flag), which is why the check keys on the input: a row whose input
   * carries the new content (`content`, `body`, `textEdits`, a section batch's
   * `edits`) is a content write.
   */
  it('[ac:ac-kazdy-wiersz-katalogu-l3-opisujacy-op] every operation that writes content declares literal, diff or both — never n/a, never silence', () => {
    const CONTENT_FIELDS = ['content', 'body', 'textEdits', 'edits'];
    const writesFiles = CATALOG.list().filter((op) => op.sideEffects.includes('file'));
    const contentWrites = writesFiles.filter((op) => CONTENT_FIELDS.some((f) => f in op.inputSchema));
    // A guard against the guard: if this ever comes back empty the assertion
    // below would pass while proving nothing.
    expect(contentWrites.length).toBeGreaterThan(3);
    for (const op of writesFiles) expect(op.contentInput, op.name).toBeDefined();
    for (const op of contentWrites) {
      expect(['literal', 'diff', 'literal+diff'], op.name).toContain(op.contentInput);
    }
    // The page-content writes: both modes on the two the criterion names, the
    // literal one on create; the page writes that carry no content say so.
    expect(CATALOG.require('update_page').contentInput).toBe('literal+diff');
    expect(CATALOG.require('update_sections').contentInput).toBe('literal+diff');
    expect(CATALOG.require('create_page').contentInput).toBe('literal');
    expect(CATALOG.require('delete_page').contentInput).toBe('n/a');
    expect(CATALOG.require('move_page').contentInput).toBe('n/a');
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
  it('every internal/mcp `direct` cell of an M39 row has a tool registered on its server (the whole-catalogue check is in `the catalogue against the window\'s 77 records`)', () => {
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
    // …and the row points at exactly those two renderings.
    expect(op.renderings).toEqual({ internal: ['entity-tools.get_field_content'], mcp: ['c4s-reader.get_field_content'] });
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
    // `runTransagent` is the TOOL name, and stays undeclared on purpose: the
    // OPERATION it renders is `spawn_child_turn` (2.1.26 — its `renderings`),
    // rather than renaming either side to match the other.
    expect(CATALOG.has('runTransagent')).toBe(false);
    expect(toolAdmittedByProfile('brief', 'runTransagent')).toBe(true);
  });

  it('declares run_turn, reached internally via spawn_child_turn, whose rendering is the differently-named runTransagent', () => {
    /**
     * 0.2.15. The spec has always called this operation `run_turn`; the code has
     * always called its one rendering `runTransagent`, and the catalog knew
     * neither — so the gate took the permissive branch for it, which makes an
     * omission indistinguishable from a decision. 2.1.26: the `run-turn` record
     * has `mcp: n/a` — an external connection is not a turn — and the tool is
     * recorded as the rendering of `spawn_child_turn`, the `via` target.
     */
    const row = CATALOG.require('run_turn');
    expect(row.opClass).toBe('turn');
    expect(row.idempotent).toBe(false);
    expect(row.channels.mcp.kind).toBe('na');
    expect(CATALOG.require('spawn_child_turn').renderings).toEqual({ internal: ['transagent-tools.runTransagent'] });
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

  it('[entity:create-entities] create_entities: project, direct, internal/mcp/rest direct and cli n/a (generic c4s entity commands only read), file/db/ui-notify, not idempotent, literal, codes INVALID_TYPE, SLUG_CONFLICT, VALIDATION, rendered by entity-tools · create_entities', () => {
    expectRecordRow({
      nazwa: 'create_entities',
      mediacja: 'direct',
      channels: { internal: D, cli: { kind: 'na', reason: CLI_NA_ENTITY }, mcp: D, rest: D },
      idempotencja: false,
      opisTresci: 'literal',
      kodyBledow: ['INVALID_TYPE', 'SLUG_CONFLICT', 'VALIDATION'],
      narzedzia: { internal: ['entity-tools-create-entities'], mcp: ['entity-tools-create-entities'] },
    });
  });

  it('[entity:update-entities] update_entities: project, direct, internal/mcp/rest direct and cli n/a (generic c4s entity commands only read), file/db/ui-notify, idempotent, literal, codes INVALID_TYPE, ENTITY_NOT_FOUND, VALIDATION, VERSION_CONFLICT, rendered by entity-tools · update_entities, addressed by (type, slug) with an optional per-item expectedVersion guard', () => {
    expectRecordRow({
      nazwa: 'update_entities',
      mediacja: 'direct',
      channels: { internal: D, cli: { kind: 'na', reason: CLI_NA_ENTITY }, mcp: D, rest: D },
      idempotencja: true,
      opisTresci: 'literal',
      kodyBledow: ['INVALID_TYPE', 'ENTITY_NOT_FOUND', 'VALIDATION', 'VERSION_CONFLICT'],
      narzedzia: { internal: ['entity-tools-update-entities'], mcp: ['entity-tools-update-entities'] },
    });
    const shape = z.object(CATALOG.require('update_entities').inputSchema as z.ZodRawShape);
    expect(shape.safeParse({ type: 'ac', updates: [{ slug: 'a', data: { title: 'x' }, newSlug: 'b' }] }).success).toBe(true);
    expect(shape.safeParse({ type: 'ac', updates: [{ data: { title: 'x' } }] }).success).toBe(false);
    // Guard `opcjonalny`: an item may carry an integer `expectedVersion`, or none.
    expect(shape.safeParse({ type: 'ac', updates: [{ slug: 'a', data: {}, expectedVersion: 3 }] }).success).toBe(true);
    expect(shape.safeParse({ type: 'ac', updates: [{ slug: 'a', data: {}, expectedVersion: 1.5 }] }).success).toBe(false);
    expect(shape.safeParse({ type: 'ac', updates: [{ slug: 'a', data: {}, expectedVersion: '3' }] }).success).toBe(false);
    // VERSION_CONFLICT is a conflict with server state the caller can resolve by re-reading.
    expect(httpStatusForCode('VERSION_CONFLICT')).toBe(409);
  });

  it('[entity:delete-entities] delete_entities: project, direct, all four channels direct, file/db/ui-notify, not idempotent, no content input, codes INVALID_TYPE, ENTITY_NOT_FOUND, VALIDATION, rendered by entity-tools · delete_entities', () => {
    expectRecordRow({
      nazwa: 'delete_entities',
      mediacja: 'direct',
      channels: { internal: D, cli: { kind: 'na', reason: CLI_NA_ENTITY }, mcp: D, rest: D },
      idempotencja: false,
      opisTresci: 'n/a',
      kodyBledow: ['INVALID_TYPE', 'ENTITY_NOT_FOUND', 'VALIDATION'],
      narzedzia: { internal: ['entity-tools-delete-entities'], mcp: ['entity-tools-delete-entities'] },
    });
  });

  it('[entity:link-dto] link_dto: project, direct, all four channels direct (rest through the endpoint plugin routes /api/endpoints/:slug/dtos), file/db/ui-notify, idempotent, no content input, codes NOT_FOUND, VALIDATION, rendered by endpoint-tools · link_dto', () => {
    expectRecordRow({
      nazwa: 'link_dto',
      mediacja: 'direct',
      channels: { internal: D, cli: { kind: 'na', reason: CLI_NA_ENTITY }, mcp: D, rest: D },
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

  it('[entity:unlink-dto] unlink_dto: project, direct, all four channels direct (rest through the endpoint plugin routes /api/endpoints/:slug/dtos), file/db/ui-notify, idempotent, no content input, codes NOT_FOUND, VALIDATION, rendered by endpoint-tools · unlink_dto', () => {
    expectRecordRow({
      nazwa: 'unlink_dto',
      mediacja: 'direct',
      channels: { internal: D, cli: { kind: 'na', reason: CLI_NA_ENTITY }, mcp: D, rest: D },
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

/**
 * 2.1.26 — the page operations (M02 `create-page`, `update-page`, `delete-page`,
 * `move-page`; M06 `update-sections`) and the UI read routes of M08, M14 and M30
 * (`get-todo-counts`, `list-todos`, `get-page-link-counts`, `list-page-links`,
 * `search-link-targets`, `get-static-file`) as their `spec-operation` records
 * declare them. Each row: name = `nazwa`, scope, mediation, the four channel
 * cells (an `n/a` / `via` carrying the record's `powody` verbatim), side effects
 * (`efekty`), idempotence (`warunkowa` → `'conditional'`), content input
 * (`opisTresci`: `dosłowny` → `literal`, `obydwa` → `literal+diff`, `n/d` →
 * `n/a` on a file write and nothing on a read), `errorCodes` exactly the record's
 * `kodyBledow` (`n/d` → none), and `renderings` exactly its `narzedzia`.
 */
describe('the page, TODO, page-link and static-file rows as their 2.1.26 records declare them', () => {
  type Cell = { kind: 'direct' } | { kind: 'via'; operation: string; reason: string } | { kind: 'na'; reason: string };
  interface PageRecord {
    nazwa: string;
    opClass: 'write' | 'read';
    channels: Record<ChannelName, Cell>;
    efekty: string[];
    idempotencja: boolean | 'conditional';
    opisTresci: 'literal' | 'literal+diff' | 'n/a' | undefined;
    kodyBledow: string[];
    narzedzia: Partial<Record<'internal' | 'mcp', string[]>>;
  }
  const D: Cell = { kind: 'direct' };
  const NO_CLI = (reason: string): Record<ChannelName, Cell> => ({ internal: D, cli: { kind: 'na', reason }, mcp: D, rest: D });
  const PAGE_EFFECTS = ['file', 'db', 'ui-notify'];

  const pageTools = new Set(
    createPageToolsServer({
      sections: {},
      resolveRoot: () => undefined,
      rootIds: () => [],
    } as unknown as PageToolsDeps).tools.map((t) => t.name),
  );

  function expectRecordRow(record: PageRecord): void {
    const op = CATALOG.require(record.nazwa);
    expect(op.name).toBe(record.nazwa);
    expect(op.scope).toBe('project');
    expect(op.mediation).toBe('direct');
    expect(op.opClass).toBe(record.opClass);
    for (const channel of CHANNELS) {
      expect(op.channels[channel], `${record.nazwa}.${channel}`).toEqual(record.channels[channel]);
    }
    expect(op.sideEffects).toEqual(record.efekty);
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
        expect(server).toBe('page-tools');
        expect(pageTools.has(name), rendering).toBe(true);
      }
    }
  }

  const required = (name: string, key: string): boolean =>
    !(CATALOG.require(name).inputSchema[key] as unknown as { isOptional(): boolean }).isOptional();

  it('[entity:create-page] create_page: project, direct, all four channels direct, file/db/ui-notify, not idempotent, literal, codes PAGE_EXISTS, ROOT_NOT_FOUND, INVALID_ARGUMENT, VALIDATION, rendered by page-tools · create_page, addressed by (rootId, path), no guard', () => {
    expectRecordRow({
      nazwa: 'create_page',
      opClass: 'write',
      channels: NO_CLI(CLI_NA_PAGES),
      efekty: PAGE_EFFECTS,
      idempotencja: false,
      opisTresci: 'literal',
      kodyBledow: ['PAGE_EXISTS', 'ROOT_NOT_FOUND', 'INVALID_ARGUMENT', 'VALIDATION'],
      narzedzia: { internal: ['page-tools-create-page'], mcp: ['page-tools-create-page'] },
    });
    expect(Object.keys(CATALOG.require('create_page').inputSchema).sort()).toEqual(['content', 'path', 'rootId', 'title']);
    expect(required('create_page', 'rootId') && required('create_page', 'path')).toBe(true);
    // `guard: n/d` — the path collision is the guard; no expectedHash.
    expect(CATALOG.require('create_page').inputSchema).not.toHaveProperty('expectedHash');
  });

  it('[entity:update-page] update_page: project, direct, all four channels direct, file/db/ui-notify, conditionally idempotent, literal+diff, codes PAGE_CONFLICT, ROOT_NOT_FOUND, INVALID_ARGUMENT, FIND_NOT_FOUND, MATCH_COUNT_MISMATCH, ANCHOR_LOSS, VALIDATION, rendered by page-tools · update_page, required guard', () => {
    expectRecordRow({
      nazwa: 'update_page',
      opClass: 'write',
      channels: NO_CLI(CLI_NA_PAGES),
      efekty: PAGE_EFFECTS,
      idempotencja: 'conditional',
      opisTresci: 'literal+diff',
      kodyBledow: ['PAGE_CONFLICT', 'ROOT_NOT_FOUND', 'INVALID_ARGUMENT', 'FIND_NOT_FOUND', 'MATCH_COUNT_MISMATCH', 'ANCHOR_LOSS', 'VALIDATION'],
      narzedzia: { internal: ['page-tools-update-page'], mcp: ['page-tools-update-page'] },
    });
    expect(required('update_page', 'rootId') && required('update_page', 'path')).toBe(true);
    expect(required('update_page', 'expectedHash')).toBe(true);
    // The two content descriptions are both offered, each optional: `body` (+ `frontmatter`) or `textEdits`.
    for (const key of ['body', 'frontmatter', 'textEdits']) expect(required('update_page', key), key).toBe(false);
  });

  it('[entity:delete-page] delete_page: project, direct, all four channels direct, file/db/ui-notify, idempotent, no content input, codes ROOT_NOT_FOUND, PAGE_CONFLICT, VALIDATION, rendered by page-tools · delete_page, optional guard', () => {
    expectRecordRow({
      nazwa: 'delete_page',
      opClass: 'write',
      channels: NO_CLI(CLI_NA_PAGES),
      efekty: PAGE_EFFECTS,
      idempotencja: true,
      opisTresci: 'n/a',
      kodyBledow: ['ROOT_NOT_FOUND', 'PAGE_CONFLICT', 'VALIDATION'],
      narzedzia: { internal: ['page-tools-delete-page'], mcp: ['page-tools-delete-page'] },
    });
    expect(Object.keys(CATALOG.require('delete_page').inputSchema).sort()).toEqual(['expectedHash', 'path', 'rootId']);
    // `guard: opcjonalny`.
    expect(required('delete_page', 'expectedHash')).toBe(false);
  });

  it('[entity:move-page] move_page: project, direct, all four channels direct, file/db/ui-notify, not idempotent, no content input, codes PAGE_CONFLICT, PAGE_EXISTS, NOT_FOUND, ROOT_NOT_FOUND, INVALID_ARGUMENT, NOT_IMPLEMENTED, rendered by page-tools · move_page, addressed by (rootId, from → to), required guard', () => {
    expectRecordRow({
      nazwa: 'move_page',
      opClass: 'write',
      channels: NO_CLI(CLI_NA_PAGES),
      efekty: PAGE_EFFECTS,
      idempotencja: false,
      opisTresci: 'n/a',
      kodyBledow: ['PAGE_CONFLICT', 'PAGE_EXISTS', 'NOT_FOUND', 'ROOT_NOT_FOUND', 'INVALID_ARGUMENT', 'NOT_IMPLEMENTED'],
      narzedzia: { internal: ['page-tools-move-page'], mcp: ['page-tools-move-page'] },
    });
    expect(Object.keys(CATALOG.require('move_page').inputSchema).sort()).toEqual(['expectedHash', 'from', 'rootId', 'to']);
    for (const key of ['rootId', 'from', 'to', 'expectedHash']) expect(required('move_page', key), key).toBe(true);
  });

  it('[entity:update-sections] update_sections: project, direct, all four channels direct, file/db/ui-notify, conditionally idempotent, literal+diff, codes SECTION_NOT_FOUND, INVALID_ARGUMENT, FIND_NOT_FOUND, MATCH_COUNT_MISMATCH, ANCHOR_LOSS, ANCHOR_DUPLICATE, INDEX_STALE, PAGE_CONFLICT, ROOT_NOT_FOUND, VALIDATION, rendered by page-tools · update_sections, addressed by anchor, a batch under one required guard', () => {
    expectRecordRow({
      nazwa: 'update_sections',
      opClass: 'write',
      channels: NO_CLI(CLI_NA_SECTION),
      efekty: PAGE_EFFECTS,
      idempotencja: 'conditional',
      opisTresci: 'literal+diff',
      kodyBledow: [
        'SECTION_NOT_FOUND',
        'INVALID_ARGUMENT',
        'FIND_NOT_FOUND',
        'MATCH_COUNT_MISMATCH',
        'ANCHOR_LOSS',
        'ANCHOR_DUPLICATE',
        'INDEX_STALE',
        'PAGE_CONFLICT',
        'ROOT_NOT_FOUND',
        'VALIDATION',
      ],
      narzedzia: { internal: ['page-tools-update-sections'], mcp: ['page-tools-update-sections'] },
    });
    // Addressed by anchor — no rootId, no path: the index resolves both.
    const shape = z.object(CATALOG.require('update_sections').inputSchema as z.ZodRawShape);
    expect(Object.keys(CATALOG.require('update_sections').inputSchema).sort()).toEqual(['dropAnchors', 'edits', 'expectedHash']);
    expect(shape.safeParse({ expectedHash: 'h', edits: [{ anchor: 'a', action: 'rename', heading: 'H' }, { anchor: 'b', action: 'delete' }] }).success).toBe(true);
    expect(shape.safeParse({ expectedHash: 'h', edits: [] }).success).toBe(false);
    expect(shape.safeParse({ edits: [{ anchor: 'a', action: 'delete' }] }).success).toBe(false);
  });

  const uiRouteOnly = (): Record<ChannelName, Cell> => ({
    internal: { kind: 'na', reason: 'kod renderuje operację wyłącznie trasą REST interfejsu, a katalog operacji kodu jej nie deklaruje' },
    cli: { kind: 'na', reason: 'brak komendy `c4s`; kod renderuje operację wyłącznie trasą REST interfejsu' },
    mcp: { kind: 'na', reason: 'kod renderuje operację wyłącznie trasą REST interfejsu, a katalog operacji kodu jej nie deklaruje' },
    rest: D,
  });

  it('[entity:get-todo-counts] get_todo_counts: project, direct, internal/cli/mcp n/a with the record\'s reasons, rest direct, no effects, idempotent, no codes, no renderings, no target', () => {
    expectRecordRow({
      nazwa: 'get_todo_counts',
      opClass: 'read',
      channels: uiRouteOnly(),
      efekty: ['none'],
      idempotencja: true,
      opisTresci: undefined,
      kodyBledow: [],
      narzedzia: {},
    });
    expect(CATALOG.require('get_todo_counts').inputSchema).toEqual({});
  });

  it('[entity:list-todos] list_todos: project, direct, internal/cli/mcp n/a with the record\'s reasons, rest direct, no effects, idempotent, no codes, no renderings, the whole project at once (no window parameters)', () => {
    expectRecordRow({
      nazwa: 'list_todos',
      opClass: 'read',
      channels: uiRouteOnly(),
      efekty: ['none'],
      idempotencja: true,
      opisTresci: undefined,
      kodyBledow: [],
      narzedzia: {},
    });
    // No window and no response budget: no limit/offset to pass.
    expect(CATALOG.require('list_todos').inputSchema).toEqual({});
  });

  it('[entity:get-page-link-counts] get_page_link_counts: project, direct, internal/cli/mcp n/a with the record\'s reasons, rest direct, no effects, idempotent, no codes, no renderings, no target', () => {
    expectRecordRow({
      nazwa: 'get_page_link_counts',
      opClass: 'read',
      channels: uiRouteOnly(),
      efekty: ['none'],
      idempotencja: true,
      opisTresci: undefined,
      kodyBledow: [],
      narzedzia: {},
    });
    expect(CATALOG.require('get_page_link_counts').inputSchema).toEqual({});
  });

  it('[entity:list-page-links] list_page_links: project, direct, internal/cli/mcp n/a with the record\'s reasons, rest direct, no effects, idempotent, no codes, no renderings, the whole project at once (no window parameters)', () => {
    expectRecordRow({
      nazwa: 'list_page_links',
      opClass: 'read',
      channels: uiRouteOnly(),
      efekty: ['none'],
      idempotencja: true,
      opisTresci: undefined,
      kodyBledow: [],
      narzedzia: {},
    });
    expect(CATALOG.require('list_page_links').inputSchema).toEqual({});
  });

  it('[entity:search-link-targets] search_link_targets: project, direct, internal/cli/mcp via search_pages with the record\'s reasons, rest direct, no effects, idempotent, no codes, no renderings, at most 50 candidates', () => {
    const viaSearch = (reason: string): Cell => ({ kind: 'via', operation: 'search_pages', reason });
    const agentReason =
      'podpowiadanie pod kursor jest potrzebą edytora, a agent adresuje strony pełną ścieżką i sięga po `pathInclude`';
    expectRecordRow({
      nazwa: 'search_link_targets',
      opClass: 'read',
      channels: {
        internal: viaSearch(agentReason),
        cli: viaSearch(
          'podpowiadanie pod kursor jest potrzebą edytora; w terminalu stronę znajduje się wyszukiwaniem stron zawężonym po ścieżce (`pathInclude`)',
        ),
        mcp: viaSearch(agentReason),
        rest: D,
      },
      efekty: ['none'],
      idempotencja: true,
      opisTresci: undefined,
      kodyBledow: [],
      narzedzia: {},
    });
    // The operation it goes via is in the catalog.
    expect(CATALOG.has('search_pages')).toBe(true);
    // Top-N: 50 at most, never the whole map.
    const shape = z.object(CATALOG.require('search_link_targets').inputSchema as z.ZodRawShape);
    expect(shape.safeParse({ q: 'guides/', limit: 50, root: 'pages' }).success).toBe(true);
    expect(shape.safeParse({ q: 'guides/', limit: 51 }).success).toBe(false);
    expect(shape.safeParse({}).success).toBe(true);
  });

  it('[entity:get-static-file] get_static_file: project, direct, internal/cli/mcp n/a with the record\'s reasons, rest direct, no effects, idempotent, code ROOT_NOT_FOUND, no renderings, addressed by (rootId, path)', () => {
    const agentReason = 'wynikiem są bajty pod render w iframe; treść spec agent czyta operacjami rdzenia M39';
    expectRecordRow({
      nazwa: 'get_static_file',
      opClass: 'read',
      channels: {
        internal: { kind: 'na', reason: agentReason },
        cli: { kind: 'na', reason: 'plik jest adresowalny wprost URL-em, więc komenda nie dodaje nic ponad pobranie bajtów' },
        mcp: { kind: 'na', reason: agentReason },
        rest: D,
      },
      efekty: ['none'],
      idempotencja: true,
      opisTresci: undefined,
      kodyBledow: ['ROOT_NOT_FOUND'],
      narzedzia: {},
    });
    expect(Object.keys(CATALOG.require('get_static_file').inputSchema).sort()).toEqual(['path', 'rootId']);
    expect(required('get_static_file', 'rootId') && required('get_static_file', 'path')).toBe(true);
  });

  it('none of the six read rows is a tool name on any server the profile gate could be asked about', () => {
    // The rows are `read`; were a tool to carry one of these names the gate would
    // classify it by this row. No MCP rendering exists (`narzedzia: []`).
    for (const name of ['get_todo_counts', 'list_todos', 'get_page_link_counts', 'list_page_links', 'search_link_targets', 'get_static_file']) {
      expect(pageTools.has(name), name).toBe(false);
      expect(CATALOG.require(name).renderings, name).toBeUndefined();
    }
  });
});

/**
 * 2.1.55 — M25 Release Push is gone, and with it its three `spec-operation`
 * records (`push-release`, `list-release-pushes`, `get-release-push`): the
 * catalogue declares none of the three rows, so no channel serves them, and
 * the codes only they raised are no longer in the status table.
 */
describe('the M25 release-push rows are no longer declared (2.1.55)', () => {
  it('[entity:push-release] push_release is not declared in the catalogue — no channel serves it', () => {
    expect(CATALOG.has('push_release')).toBe(false);
    expect(CATALOG.get('push_release')).toBeUndefined();
    expect(OPERATION_RULES).not.toHaveProperty('push_release');
    expect(STATUS_FOR_CODE).not.toHaveProperty('ACCOUNT_NOT_ACTIVE');
    expect(STATUS_FOR_CODE).not.toHaveProperty('PUSH_FAILED');
  });

  it('[entity:list-release-pushes] list_release_pushes is not declared in the catalogue — no channel serves it', () => {
    expect(CATALOG.has('list_release_pushes')).toBe(false);
    expect(CATALOG.get('list_release_pushes')).toBeUndefined();
    expect(OPERATION_RULES).not.toHaveProperty('list_release_pushes');
  });

  it('[entity:get-release-push] get_release_push is not declared in the catalogue — no channel serves it', () => {
    expect(CATALOG.has('get_release_push')).toBe(false);
    expect(CATALOG.get('get_release_push')).toBeUndefined();
    expect(OPERATION_RULES).not.toHaveProperty('get_release_push');
    expect(STATUS_FOR_CODE).not.toHaveProperty('RELEASE_PUSH_NOT_FOUND');
  });

  it('no catalogue row names a release push, on any channel', () => {
    for (const op of CATALOG.list()) expect(op.name, op.name).not.toMatch(/release_push/);
  });
});

/**
 * 2.1.26 — the M05 / M11 / M46 turn and thread rows as their `spec-operation`
 * records declare them (`ask`, `abort-turn`, `create-thread`, `delete-thread`,
 * `list-threads`, `run-turn`, `spawn-child-turn`). The `na` / `via` reasons are
 * the records' `powody`, verbatim; `narzedzia` resolves through the two mcp-tool
 * records named here. The behaviour (`zachowanie`) is held where it is
 * implemented: `routes/chat.ts` (abort), `routes/threads.ts` +
 * `services/chat.ts` (threads), `mcp/transagent-tools.test.ts` (spawn) and
 * `mcp/c4s-tools.test.ts` (ask).
 */
describe('the turn and thread rows as their 2.1.26 records declare them', () => {
  const D = { kind: 'direct' } as const;
  const TOOLS = {
    'c4s-tools-ask': { server: 'c4s-tools', name: 'ask' },
    'transagent-tools-runtransagent': { server: 'transagent-tools', name: 'runTransagent' },
  } as const;
  const THREADS = 'katalog wątków jest wewnętrzną sprawą interfejsu';
  const THREAD_CHANNELS = {
    internal: { kind: 'na', reason: THREADS },
    cli: { kind: 'na', reason: THREADS },
    mcp: { kind: 'na', reason: THREADS },
    rest: D,
  } as const;
  const optional = (name: string, key: string): boolean =>
    (CATALOG.require(name).inputSchema[key] as unknown as { isOptional(): boolean }).isOptional();

  it('[entity:ask] ask: workspace, agent-mediated, all four channels direct, file/db, not idempotent, no content input, the fifteen codes with RESUME_CONFIG_LOCKED, rendered by c4s-tools-ask in internal and mcp, effort a closed choice', () => {
    const op = expectOperationMatchesRecord(
      {
        nazwa: 'ask',
        zasieg: 'workspace',
        mediacja: 'agent-mediated',
        channels: { internal: D, cli: D, mcp: D, rest: D },
        efekty: ['file', 'db'],
        idempotencja: false,
        opisTresci: 'n/a',
        kodyBledow: [
          'PROJECT_NOT_FOUND',
          'PROJECT_ID_NOT_FOUND',
          'AMBIGUOUS_WORKSPACE',
          'AMBIGUOUS_PROJECT',
          'PROJECT_NOT_IN_WORKSPACE',
          'SERVER_NOT_RUNNING',
          'SERVER_NOT_RECOGNIZED',
          'INVALID_ARGS',
          'NOT_FOUND',
          'STREAM_IN_PROGRESS',
          'AGENT_UNAVAILABLE',
          'AGENT_ERROR',
          'TIMEOUT',
          'ABORTED',
          'RESUME_CONFIG_LOCKED',
        ],
        narzedzia: { internal: ['c4s-tools-ask'], mcp: ['c4s-tools-ask'] },
      },
      TOOLS,
    );
    expect(op.errorCodes).toHaveLength(15);
    expect(op.opClass).toBe('peer');
    // The peer's context is fixed, not a parameter: no contextType / brief input.
    expect(Object.keys(op.inputSchema).sort()).toEqual(
      ['effort', 'message', 'model', 'project', 'server', 'threadId', 'workspace'].sort(),
    );
    const shape = z.object(op.inputSchema as z.ZodRawShape);
    expect(shape.safeParse({ message: 'q', project: 'p', effort: 'high' }).success).toBe(true);
    expect(shape.safeParse({ message: 'q', project: 'p', effort: 'max' }).success).toBe(false);
  });

  it('[entity:abort-turn] abort_turn: project, direct, internal/cli/mcp n/a (rest is the only rendering), rest direct, db/ui-notify, idempotent, no content input, codes THREAD_NOT_FOUND and VALIDATION, addressed by threadId or the request id, no rendering', () => {
    // Not through the shared matcher: the record's `opisTresci` is `n/d` on a row
    // with no `file` effect, which the row leaves undeclared. Every other field is
    // asserted the way the matcher asserts it.
    const op = CATALOG.require('abort_turn');
    expect(op.name).toBe('abort_turn');
    expect(op.scope).toBe('project');
    expect(op.mediation).toBe('direct');
    expect(op.channels.rest).toEqual(D);
    for (const channel of ['internal', 'cli', 'mcp'] as const) expect(op.channels[channel].kind, channel).toBe('na');
    expect([...op.sideEffects].sort()).toEqual(['db', 'ui-notify']);
    expect(op.idempotent).toBe(true);
    expect(op.contentInput).toBeUndefined();
    expect(new Set(op.errorCodes).size).toBe(op.errorCodes.length);
    expect([...op.errorCodes].sort()).toEqual(['THREAD_NOT_FOUND', 'VALIDATION']);
    expect(op.renderings ?? {}).toEqual({});
    expect(op.opClass).toBe('turn');
    expect(Object.keys(op.inputSchema).sort()).toEqual(['requestId', 'threadId']);
    expect(optional('abort_turn', 'threadId')).toBe(true);
    expect(optional('abort_turn', 'requestId')).toBe(true);
    // The answer is a confirmation, not the thread's state.
    expect(op.summary).toMatch(/\{ aborted, clearedTexts \}/);
  });

  it('[entity:create-thread] create_thread: project, human-mediated, internal/cli/mcp n/a (the thread catalogue is the UI\'s), rest direct, db/ui-notify, not idempotent, code VALIDATION, no renderings', () => {
    const op = expectOperationMatchesRecord(
      {
        nazwa: 'create_thread',
        mediacja: 'human-mediated',
        channels: THREAD_CHANNELS,
        efekty: ['db', 'ui-notify'],
        idempotencja: false,
        opisTresci: undefined,
        kodyBledow: ['VALIDATION'],
        narzedzia: {},
      },
      TOOLS,
    );
    expect(Object.keys(op.inputSchema).sort()).toEqual(['context_type', 'title']);
    expect(op.summary).toMatch(/VALIDATION/);
  });

  it('[entity:delete-thread] delete_thread: project, human-mediated, internal/cli/mcp n/a, rest direct, db/ui-notify, idempotent, code NOT_FOUND, addressed by threadId, no renderings', () => {
    const op = expectOperationMatchesRecord(
      {
        nazwa: 'delete_thread',
        mediacja: 'human-mediated',
        channels: THREAD_CHANNELS,
        efekty: ['db', 'ui-notify'],
        idempotencja: true,
        opisTresci: undefined,
        kodyBledow: ['NOT_FOUND'],
        narzedzia: {},
      },
      TOOLS,
    );
    expect(Object.keys(op.inputSchema)).toEqual(['threadId']);
    expect(optional('delete_thread', 'threadId')).toBe(false);
  });

  it('[entity:list-threads] list_threads: project, human-mediated, internal/cli/mcp n/a, rest direct, no effects, idempotent, no codes of its own, a limit/offset window', () => {
    const op = expectOperationMatchesRecord(
      {
        nazwa: 'list_threads',
        mediacja: 'human-mediated',
        channels: THREAD_CHANNELS,
        efekty: ['none'],
        idempotencja: true,
        opisTresci: undefined,
        kodyBledow: [],
        narzedzia: {},
      },
      TOOLS,
    );
    expect(Object.keys(op.inputSchema).sort()).toEqual(['limit', 'offset']);
    expect(op.summary).toMatch(/20 rows/);
  });

  it('[entity:run-turn] run_turn: project, direct, internal via spawn_child_turn, cli/mcp/rest n/a, file/db/ui-notify, not idempotent, no content input, codes AGENT_ERROR, STREAM_IN_PROGRESS, RESUME_CONFIG_LOCKED, NOT_FOUND, no renderings', () => {
    expectOperationMatchesRecord(
      {
        nazwa: 'run_turn',
        channels: {
          internal: {
            kind: 'via',
            operation: 'spawn_child_turn',
            reason:
              'agent wbudowany osiąga bieg tury wyłącznie zakładając wątek podrzędny; tury najwyższego poziomu z wnętrza własnej tury nie zleca',
          },
          cli: { kind: 'na', reason: 'brak powierzchni CLI — turę-dziecko zakłada się wyłącznie z wnętrza tury' },
          mcp: {
            kind: 'na',
            reason:
              'połączenie zewnętrzne nie jest turą: serwer zakładający turę-dziecko montuje się tylko w wątku czatu najwyższego poziomu, nigdy na zewnątrz',
          },
          rest: { kind: 'na', reason: 'brak powierzchni REST — jedynym wołającym jest tura-rodzic' },
        },
        efekty: ['file', 'db', 'ui-notify'],
        idempotencja: false,
        opisTresci: 'n/a',
        kodyBledow: ['AGENT_ERROR', 'STREAM_IN_PROGRESS', 'RESUME_CONFIG_LOCKED', 'NOT_FOUND'],
        narzedzia: {},
      },
      TOOLS,
    );
  });

  it('[entity:spawn-child-turn] spawn_child_turn: project, agent-mediated, internal direct rendered by transagent-tools-runtransagent, cli/mcp/rest n/a, file/db/ui-notify, not idempotent, no content input, its eight codes', () => {
    expectOperationMatchesRecord(
      {
        nazwa: 'spawn_child_turn',
        mediacja: 'agent-mediated',
        channels: {
          internal: D,
          cli: { kind: 'na', reason: 'operacja wewnętrzna — osiągalna wyłącznie przez `run_turn` z wnętrza tury' },
          mcp: {
            kind: 'na',
            reason: 'operacja wewnętrzna; połączenie zewnętrzne nie jest turą, więc nie ma tury, której wątek byłby dzieckiem',
          },
          rest: {
            kind: 'na',
            reason:
              'operacja wewnętrzna bez powierzchni REST; wątek-dziecko jest wykluczony z listy wątków, więc z zewnątrz nie ma adresu',
          },
        },
        efekty: ['file', 'db', 'ui-notify'],
        idempotencja: false,
        opisTresci: 'n/a',
        kodyBledow: [
          'AGENT_ERROR',
          'TIMEOUT',
          'IDLE_TIMEOUT',
          'ABORTED',
          'INVALID_ARGS',
          'NOT_FOUND',
          'STREAM_IN_PROGRESS',
          'RESUME_CONFIG_LOCKED',
        ],
        narzedzia: { internal: ['transagent-tools-runtransagent'] },
      },
      TOOLS,
    );
  });
});

/**
 * 2.1.26 — the five M18 tag write rows as their `spec-operation` records declare
 * them: project, direct, all four channels direct, file/db/ui-notify, no content
 * input, the record's own `kodyBledow` (no dedicated `INACTIVE_TYPE` /
 * `ENTITY_NOT_FOUND` any more), and the namesake `reference-tools` tool as the
 * rendering in both agentic channels. The behaviour (`zachowanie`) is held in
 * `mcp/reference-tools.tags.test.ts`.
 */
describe('the M18 tag write rows as their 2.1.26 records declare them', () => {
  const D = { kind: 'direct' } as const;
  const TAG_CHANNELS = { internal: D, cli: { kind: 'na', reason: CLI_NA_TAGS }, mcp: D, rest: D } as const;
  const keys = (name: string) => Object.keys(CATALOG.require(name).inputSchema).sort();
  const tagRow = (nazwa: string, slug: string, idempotencja: boolean, kodyBledow: string[]) =>
    expectOperationMatchesRecord(
      {
        nazwa,
        channels: TAG_CHANNELS,
        efekty: ['file', 'db', 'ui-notify'],
        idempotencja,
        opisTresci: 'n/a',
        kodyBledow,
        narzedzia: { internal: [slug], mcp: [slug] },
      },
      TAG_TOOL_RECORDS,
    );

  it('[entity:create-tag] create_tag: project, direct, all four channels direct, file/db/ui-notify, not idempotent, no content input, codes VALIDATION, SLUG_CONFLICT, rendered by reference-tools · create_tag, no address (the slug is derived, never supplied)', () => {
    const op = tagRow('create_tag', 'reference-tools-create-tag', false, ['VALIDATION', 'SLUG_CONFLICT']);
    expect(op.opClass).toBe('write');
    expect(keys('create_tag')).toEqual(['color', 'description', 'name']);
    expect(op.errorCodes).not.toContain('NOT_FOUND');
  });

  it('[entity:update-tag] update_tag: project, direct, all four channels direct, file/db/ui-notify, idempotent, no content input, codes VALIDATION, NOT_FOUND, SLUG_CONFLICT, rendered by reference-tools · update_tag, addressed by the tag slug', () => {
    const op = tagRow('update_tag', 'reference-tools-update-tag', true, ['VALIDATION', 'NOT_FOUND', 'SLUG_CONFLICT']);
    expect(op.opClass).toBe('write');
    expect(keys('update_tag')).toEqual(['data', 'slug']);
  });

  it('[entity:delete-tag] delete_tag: project, direct, all four channels direct, file/db/ui-notify, idempotent, no content input, codes VALIDATION, NOT_FOUND, rendered by reference-tools · delete_tag, addressed by the tag slug', () => {
    const op = tagRow('delete_tag', 'reference-tools-delete-tag', true, ['VALIDATION', 'NOT_FOUND']);
    expect(op.opClass).toBe('write');
    expect(keys('delete_tag')).toEqual(['slug']);
  });

  it('[entity:tag-entity] tag_entity: project, direct, all four channels direct, file/db/ui-notify, idempotent, no content input, codes VALIDATION, NOT_FOUND (no INACTIVE_TYPE / ENTITY_NOT_FOUND), rendered by reference-tools · tag_entity, addressed by (type, slug) plus the tag list', () => {
    const op = tagRow('tag_entity', 'reference-tools-tag-entity', true, ['VALIDATION', 'NOT_FOUND']);
    expect(op.opClass).toBe('write');
    expect(op.errorCodes).not.toContain('INACTIVE_TYPE');
    expect(op.errorCodes).not.toContain('ENTITY_NOT_FOUND');
    expect(keys('tag_entity')).toEqual(['slug', 'tags', 'type']);
  });

  it('[entity:untag-entity] untag_entity: project, direct, all four channels direct, file/db/ui-notify, idempotent, no content input, codes VALIDATION, NOT_FOUND (no INACTIVE_TYPE / ENTITY_NOT_FOUND), rendered by reference-tools · untag_entity, addressed by (type, slug) plus the tag list', () => {
    const op = tagRow('untag_entity', 'reference-tools-untag-entity', true, ['VALIDATION', 'NOT_FOUND']);
    expect(op.opClass).toBe('write');
    expect(op.errorCodes).not.toContain('INACTIVE_TYPE');
    expect(op.errorCodes).not.toContain('ENTITY_NOT_FOUND');
    expect(keys('untag_entity')).toEqual(['slug', 'tags', 'type']);
  });
});

/**
 * 2.1.26 — the whole code catalogue against the window's 78 `spec-operation`
 * records (`tests/helpers/spec-operation-records.ts`), not a sample: every record
 * has its row and every row but the plugin ones the window has no record for has
 * a record; each row answers for the record's fields; and the four L3/M43
 * criteria on `reguly` and `narzedzia` hold for every row at once.
 */
describe("the catalogue against the window's 77 records", () => {
  const RECORD_CHANNEL: Record<ChannelCell['kind'], string> = { direct: 'direct', via: 'via', na: 'n/a' };
  const EFFECT: Record<string, string> = { brak: 'none', plik: 'file', db: 'db', 'ui-notify': 'ui-notify' };
  const IDEMPOTENCE: Record<string, boolean | 'conditional'> = { tak: true, nie: false, warunkowa: 'conditional' };
  const CONTENT_INPUT: Record<string, ContentInputMode> = { dosłowny: 'literal', różnicowy: 'diff', obydwa: 'literal+diff' };
  /** The rows the window carries no record for: plugin-contributed, declared for the profile gate. */
  const PLUGIN_ROWS_WITHOUT_RECORD = [
    'analyze_ac_against_entities',
    'audit_ui_kit_components',
    'delete_column',
    'delete_row',
    'get_overview',
    'get_range',
    'insert_column',
    'insert_row',
    'set_cell',
    'set_range',
    'validate_diagram',
  ];
  /** The identifiers of M43's domain section (`ke1jxhqh`), as the page declares them. */
  const M43_RULE_IDS = [
    'echo-free',
    'guard-declared',
    'destructive-declared',
    'batch-required',
    'rename-heading-only',
    'error-code-once',
    'explicit-addressing',
    'operation-only-write',
    'diff-mode-declared',
    'literal-match',
    'match-count-declared',
    'edit-set-not-procedure',
    'replacements-returned',
    'diff-field-names',
    'claimed-spans-disjoint',
    'insertion-order',
    'delete-exclusive',
    'one-action-per-anchor',
  ];
  /**
   * The agentic `direct` cells whose own record names no tool in that channel.
   * 2.1.43 closes the list: the four records that broke L3 `g8adono9`
   * (`direct-without-tool`) are `n/a` now, so every agentic `direct` cell points
   * at a tool.
   */
  const RECORD_DIRECT_WITHOUT_TOOL: string[] = [];

  /** Source files whose tool registrations make up each server a rendering may name. */
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const SERVER_SOURCES: Record<string, string[]> = {
    'c4s-reader': ['src/server/mcp/c4s-reader.ts', 'src/server/mcp/skill-tools.ts'],
    'reference-tools': ['src/server/mcp/reference-tools.ts'],
    'entity-tools': ['src/server/mcp/entity-tools.ts'],
    'page-tools': ['src/server/mcp/page-tools.ts'],
    'brief-tools': ['src/server/mcp/brief-tools.ts'],
    'plan-tools': ['src/server/mcp/plan-tools.ts'],
    'patch-tools': ['src/server/mcp/patch-tools.ts'],
    'transagent-tools': ['src/server/mcp/transagent-tools.ts'],
    'c4s-tools': ['src/server/mcp/c4s-tools.ts'],
    'skill-tools': ['src/server/mcp/skill-tools.ts'],
    'spec-skill-tools': ['src/server/mcp/spec-skill-tools.ts'],
    'workspace-tools': ['src/server/mcp/workspace-tools.ts'],
    'release-tools': ['src/server/mcp/release-tools/index.ts'],
    'endpoint-tools': ['plugins/c4s-plugin-api-contracts/src/entity/endpoint/backend/mcp.ts'],
    'spreadsheet-tools': ['plugins/c4s-plugin-spreadsheets/src/entity/spreadsheet/mcp.ts'],
    'ac-tools': ['plugins/c4s-plugin-ac/src/entity/ac/backend/mcp.ts'],
    'diagram-tools': ['src/server/entities/diagram/mcp-server.ts'],
    // The server and tool names are constants in the package's `identity.ts`
    // (`UI_KIT_TOOLS_SERVER`, `UI_KIT_AUDIT_TOOL`), which `mcp.ts` registers by name.
    'ui-kit-component-tools': [
      'plugins/c4s-plugin-host-ui-kit-components/src/entity/ui-kit-component/backend/mcp.ts',
      'plugins/c4s-plugin-host-ui-kit-components/src/identity.ts',
    ],
  };
  /** The plugin `${type}-tools` servers whose tools the record-less plugin rows name. */
  const PLUGIN_TYPE_SERVERS = ['endpoint-tools', 'spreadsheet-tools', 'ac-tools', 'diagram-tools', 'ui-kit-component-tools'];
  const sourceOf = (server: string): string | undefined => {
    const files = SERVER_SOURCES[server];
    return files?.map((f) => fs.readFileSync(path.join(repoRoot, f), 'utf-8')).join('\n');
  };
  /** A tool exists when its server's source names the server and registers the tool by name. */
  const toolExists = (rendering: string): boolean => {
    const [server, tool] = rendering.split('.') as [string, string];
    const src = sourceOf(server);
    if (!src || !src.includes(`'${server}'`)) return false;
    if (new RegExp(`\\(\\s*'${tool}'`).test(src)) return true;
    // Registered through a named constant: `const X = '<tool>'` in the server's
    // sources, and `X` passed as the first argument of a registration call.
    const constants = [...src.matchAll(new RegExp(`\\b([A-Z][A-Z0-9_]*)\\s*=\\s*'${tool}'`, 'g'))].map((m) => m[1]!);
    return constants.some((name) => new RegExp(`\\(\\s*${name}\\s*,`).test(src));
  };

  const byName = new Map(SPEC_OPERATION_RECORDS.map((r) => [r.nazwa, r]));

  it('every one of the 77 records has its row, and every other row is a plugin row the window has no record for', () => {
    expect(SPEC_OPERATION_RECORDS).toHaveLength(77);
    expect(byName.size).toBe(77);
    for (const record of SPEC_OPERATION_RECORDS) expect(CATALOG.has(record.nazwa), record.nazwa).toBe(true);
    const withoutRecord = CATALOG.list()
      .filter((op) => !byName.has(op.name))
      .map((op) => op.name)
      .sort();
    expect(withoutRecord).toEqual(PLUGIN_ROWS_WITHOUT_RECORD);
    for (const name of withoutRecord) expect(CATALOG.require(name).contributedBy, name).toBe('plugin');
  });

  it('every row answers for its record: scope, mediation, the four channel values (a via / n/a with the record\'s reason), effects, idempotence, error codes once each', () => {
    for (const record of SPEC_OPERATION_RECORDS) {
      const op = CATALOG.require(record.nazwa);
      expect(op.scope, record.nazwa).toBe(record.zasieg);
      expect(op.mediation, record.nazwa).toBe(record.mediacja);
      for (const channel of CHANNELS) {
        const cell = op.channels[channel];
        expect(RECORD_CHANNEL[cell.kind], `${record.nazwa}.${channel}`).toBe(record[channel]);
        if (cell.kind !== 'direct') expect(cell.reason, `${record.nazwa}.${channel} reason`).toBe(record.powody[channel]);
        // 2.1.43 — the target of a `via` is its own field, and the reason never opens with "via X —".
        if (cell.kind === 'via') {
          expect(cell.operation, `${record.nazwa}.${channel} target`).toBe(record[`${channel}Via` as const]);
          expect(cell.reason, `${record.nazwa}.${channel} reason prefix`).not.toMatch(/^via\s/);
        } else {
          expect(record[`${channel}Via` as const], `${record.nazwa}.${channel} has a target without a via`).toBeUndefined();
        }
      }
      expect([...op.sideEffects].sort(), record.nazwa).toEqual(record.efekty.map((e) => EFFECT[e]).sort());
      expect(op.idempotent, record.nazwa).toBe(IDEMPOTENCE[record.idempotencja]);
      expect(new Set(op.errorCodes).size, record.nazwa).toBe(op.errorCodes.length);
      const codes = record.kodyBledow.length === 1 && record.kodyBledow[0] === 'n/d' ? [] : record.kodyBledow;
      expect([...op.errorCodes].sort(), record.nazwa).toEqual([...codes].sort());
    }
  });

  it('the content description of every row is an allowed value: a record\'s `dosłowny` / `różnicowy` / `obydwa` is literal / diff / literal+diff, and `n/d` is `n/a` — or no declaration where the row writes no file', () => {
    const allowed = new Set<ContentInputMode | undefined>(['literal', 'diff', 'literal+diff', 'n/a']);
    for (const op of CATALOG.list()) {
      if (op.contentInput !== undefined) expect(allowed.has(op.contentInput), op.name).toBe(true);
      if (op.sideEffects.includes('file')) expect(op.contentInput, op.name).toBeDefined();
    }
    for (const record of SPEC_OPERATION_RECORDS) {
      const op = CATALOG.require(record.nazwa);
      if (record.opisTresci === 'n/d') {
        if (op.sideEffects.includes('file')) expect(op.contentInput, record.nazwa).toBe('n/a');
        else expect([undefined, 'n/a'], record.nazwa).toContain(op.contentInput);
      } else {
        expect(op.contentInput, record.nazwa).toBe(CONTENT_INPUT[record.opisTresci]);
      }
    }
  });

  it('[ac:ac-kazdy-identyfikator-zacytowany-w-polu] every identifier cited in the `rules` of any row occurs in the M43 domain section — and the row cites what its record cites', () => {
    expect([...RULE_IDS]).toEqual(M43_RULE_IDS);
    const vocabulary = new Set(M43_RULE_IDS);
    const cited = new Set<string>();
    for (const op of CATALOG.list()) {
      for (const element of op.rules ?? []) {
        if (element.id === 'n/d') continue;
        cited.add(element.id);
        expect(vocabulary.has(element.id), `${op.name}: ${element.id}`).toBe(true);
      }
    }
    // Every record's `reguly` is carried over identifier for identifier.
    for (const record of SPEC_OPERATION_RECORDS) {
      const op = CATALOG.require(record.nazwa);
      expect(
        (op.rules ?? []).map((e) => ({ id: e.id, ...(e.exclusion !== undefined ? { wykluczenie: e.exclusion } : {}) })),
        record.nazwa,
      ).toEqual(record.reguly);
    }
    // The three rules a record field closes are never cited.
    for (const id of FIELD_CLOSED_RULES) expect(cited.has(id), id).toBe(false);
    // The registry refuses an identifier outside the vocabulary.
    expect(() => new OperationCatalog().register(decl({ rules: [{ id: 'made-up-rule' as RuleId }] }))).toThrow(
      /not an identifier of the M43 rules vocabulary/,
    );
  });

  it('[ac:ac-kazdy-wiersz-katalogu-operacji-ma-nie] every row with a record has a non-empty `rules` list — identifiers, elements with an exclusion, or one `n/d`', () => {
    for (const record of SPEC_OPERATION_RECORDS) {
      const rules = CATALOG.require(record.nazwa).rules;
      expect(rules, record.nazwa).toBeDefined();
      expect(rules!.length, record.nazwa).toBeGreaterThan(0);
      const nd = rules!.filter((e) => e.id === 'n/d');
      // `n/d` is the one element of a row nothing binds, never beside another.
      if (nd.length > 0) expect(rules, record.nazwa).toEqual([{ id: 'n/d' }]);
    }
    const cat = new OperationCatalog();
    expect(() => cat.register(decl({ name: 'get_empty', rules: [] }))).toThrow(/'rules' is empty/);
    expect(() => cat.register(decl({ name: 'get_mixed', rules: [{ id: 'n/d' }, { id: 'echo-free' }] }))).toThrow(
      /'n\/d' stands alone/,
    );
    expect(cat.register(decl({ name: 'get_unbound', rules: [{ id: 'n/d' }] })).rules).toEqual([{ id: 'n/d' }]);
    expect(
      cat.register(decl({ name: 'get_excluded', rules: [{ id: 'echo-free', exclusion: 'nie mutuje' }] })).rules,
    ).toEqual([{ id: 'echo-free', exclusion: 'nie mutuje' }]);
  });

  it('[ac:ac-pole-reguly-wiersza-katalogu-nie-zawi] no `rules` element of any row is a descriptive sentence: each carries a rule identifier and, at most, the reason of its exclusion', () => {
    const IDENTIFIER = /^(?:[a-z]+(?:-[a-z]+)*|n\/d)$/;
    let exclusions = 0;
    for (const op of CATALOG.list()) {
      for (const element of op.rules ?? []) {
        expect(Object.keys(element).every((k) => k === 'id' || k === 'exclusion'), `${op.name}: ${JSON.stringify(element)}`).toBe(true);
        expect(element.id, op.name).toMatch(IDENTIFIER);
        if (element.exclusion !== undefined) {
          exclusions += 1;
          expect(element.exclusion.trim().length, `${op.name}: ${element.id}`).toBeGreaterThan(0);
          expect(element.exclusion.length, `${op.name}: ${element.id}`).toBeLessThanOrEqual(300);
        }
      }
    }
    // As many exclusions as the window's records carry (twenty), none dropped and none added.
    expect(exclusions).toBe(SPEC_OPERATION_RECORDS.flatMap((r) => r.reguly).filter((e) => e.wykluczenie !== undefined).length);
    const cat = new OperationCatalog();
    expect(() =>
      cat.register(
        decl({ rules: [{ id: 'Wyjście nie powtarza treści przekazanej w parametrze.' as RuleId }] }),
      ),
    ).toThrow(OperationCatalogError);
    expect(() =>
      cat.register(decl({ name: 'get_extra', rules: [{ id: 'echo-free', note: 'zwraca adres skutku' } as unknown as RuleCitation] })),
    ).toThrow(/only 'id' and 'exclusion'/);
  });

  it('[ac:ac-wiersz-katalogu-operacji-o-wartosci-d] every row with `direct` in `internal` or `mcp` points in `renderings` at a tool rendering it in that channel, as its record\'s `narzedzia` names it', () => {
    const withoutTool: string[] = [];
    const recordless = new Set(PLUGIN_ROWS_WITHOUT_RECORD);
    for (const op of CATALOG.list()) {
      if (recordless.has(op.name)) {
        // A plugin row the window has no record for: the host core names no
        // plugin server, so the row carries no `renderings`. Its `direct` cells
        // are rendered by the contributing plugin's own `${type}-tools` server,
        // mounted at runtime — which must register a tool under the row's name.
        expect(op.contributedBy, op.name).toBe('plugin');
        expect(op.renderings, op.name).toBeUndefined();
        const servers = PLUGIN_TYPE_SERVERS.filter((server) => toolExists(`${server}.${op.name}`));
        expect(servers.length, `${op.name}: no plugin type server registers it`).toBe(1);
        continue;
      }
      for (const channel of ['internal', 'mcp'] as const) {
        const named = op.renderings?.[channel] ?? [];
        if (op.channels[channel].kind === 'direct') {
          if (named.length === 0) withoutTool.push(`${op.name}.${channel}`);
        } else {
          expect(named, `${op.name}.${channel} is not direct but names a rendering`).toEqual([]);
        }
        // Every named rendering is a tool its server registers.
        for (const rendering of named) expect(toolExists(rendering), rendering).toBe(true);
      }
    }
    // The only direct cells without a tool are the records' own (see RECORD_DIRECT_WITHOUT_TOOL).
    expect(withoutTool.sort()).toEqual(RECORD_DIRECT_WITHOUT_TOOL);
    for (const cell of RECORD_DIRECT_WITHOUT_TOOL) {
      const [name, channel] = cell.split('.') as [string, 'internal' | 'mcp'];
      const record = byName.get(name)!;
      expect(record[channel], cell).toBe('direct');
      expect(record.narzedzia[channel], cell).toBeUndefined();
    }
    // `renderings` is exactly the record's `narzedzia`, each slug resolved to `<server>.<tool>`.
    for (const record of SPEC_OPERATION_RECORDS) {
      const op = CATALOG.require(record.nazwa);
      const expected: Partial<Record<'internal' | 'mcp', string[]>> = {};
      for (const [channel, slugs] of Object.entries(record.narzedzia) as Array<['internal' | 'mcp', string[]]>) {
        expected[channel] = slugs.map((slug) => {
          const tool = CATALOGUE_TOOL_RECORDS[slug];
          expect(tool, `mcp-tool record ${slug}`).toBeDefined();
          return `${tool!.server}.${tool!.name}`;
        });
      }
      expect(op.renderings ?? {}, record.nazwa).toEqual(expected);
    }
  });
});

/**
 * 2.1.43 — the data wave of the `spec-operation` records: the `cli` cells no
 * command renders, the brief and turn operations the external server does not
 * carry, the patch reads that gained their own REST rendering, and the `via`
 * reasons that no longer repeat their target. The whole-catalogue test above
 * holds every row against the record; this block pins the changed rows by value.
 */
describe('the 2.1.43 catalogue wave', () => {
  const CLI_NA_BRIEF = 'Komendy nie zaprojektowano: komendy briefu tworzą, czytają i oznaczają brief, ale go nie edytują.';
  const CLI_NA_PROJ = "Komendy nie zaprojektowano; `c4s list-workspaces` czyta rejestr workspace'ów, a nie listę projektów serwera.";
  const CLI_NA_ABORT = 'Komendy nie zaprojektowano: przerwanie tury z terminala nie ma kontrybucji w rejestrze komend.';
  const kinds = (name: string) => {
    const c = CATALOG.require(name).channels;
    return [c.internal.kind, c.cli.kind, c.mcp.kind, c.rest.kind].map((k) => ({ direct: 'D', via: 'V', na: 'N' })[k]).join('/');
  };

  it.each([
    ['create_entities', CLI_NA_ENTITY],
    ['delete_entities', CLI_NA_ENTITY],
    ['update_entities', CLI_NA_ENTITY],
    ['link_dto', CLI_NA_ENTITY],
    ['unlink_dto', CLI_NA_ENTITY],
    ['create_page', CLI_NA_PAGES],
    ['delete_page', CLI_NA_PAGES],
    ['update_page', CLI_NA_PAGES],
    ['move_page', CLI_NA_PAGES],
    ['create_tag', CLI_NA_TAGS],
    ['delete_tag', CLI_NA_TAGS],
    ['update_tag', CLI_NA_TAGS],
    ['tag_entity', CLI_NA_TAGS],
    ['untag_entity', CLI_NA_TAGS],
    ['update_brief', CLI_NA_BRIEF],
    ['update_sections', CLI_NA_SECTION],
    ['list_projects', CLI_NA_PROJ],
  ])('%s: cli is n/a with the record\'s reason, the other channels direct', (name, reason) => {
    registerCoreOperations();
    expect(CATALOG.require(name).channels.cli).toEqual(na(reason));
    expect(kinds(name)).toBe(name === 'list_projects' ? 'D/N/D/N' : 'D/N/D/D');
  });

  it('abort_turn: rest is the only rendering, every other channel n/a with the record\'s reason', () => {
    registerCoreOperations();
    const c = CATALOG.require('abort_turn').channels;
    expect(kinds('abort_turn')).toBe('N/N/N/D');
    expect(c.internal).toEqual(
      na('moduł tury nie wnosi narzędzia agentowego: przerwanie zleca wołający spoza tury, który zna jej adres (UI albo klient trasy REST), a nie agent wewnątrz biegnącej tury'),
    );
    expect(c.cli).toEqual(na(CLI_NA_ABORT));
    expect(c.mcp).toEqual(
      na('moduł tury nie wnosi narzędzia MCP; przerwanie z zewnątrz renderuje wyłącznie trasa REST, którą woła klient zlecający turę'),
    );
  });

  it('create_brief, list_briefs, mark_brief_implemented: the external server carries none of them', () => {
    registerCoreOperations();
    expect(kinds('create_brief')).toBe('N/D/N/D');
    expect(kinds('list_briefs')).toBe('D/D/N/D');
    expect(kinds('mark_brief_implemented')).toBe('N/D/N/D');
    expect(CATALOG.require('create_brief').channels.mcp).toEqual(
      na('serwer zewnętrzny nie niesie narzędzia: powołanie briefu jest powierzchnią użytkownika (UI, `c4s create-brief`, trasa REST), a połączenie zewnętrzne w profilu `brief` widzi tylko operacje na istniejącym briefie'),
    );
    expect(CATALOG.require('list_briefs').channels.mcp).toEqual(
      na('serwer zewnętrzny nie niesie narzędzia: lista briefów jest powierzchnią użytkownika (UI, `c4s list-briefs`, trasa REST), a agentowo renderuje ją wyłącznie `transagent-tools` orkiestratora wątku `chat`'),
    );
    expect(CATALOG.require('mark_brief_implemented').channels.internal).toEqual(
      na('operacja deklaruje fakt o kodzie w repozytorium docelowym, którego wątek nie widzi, więc serwer briefu celowo jej nie niesie; znacznik ustawia implementer w terminalu albo użytkownik w UI'),
    );
    expect(CATALOG.require('mark_brief_implemented').channels.mcp).toEqual(
      na('serwer zewnętrzny nie niesie narzędzia: znacznik ustawia implementer w terminalu (`c4s mark-brief-implemented`) albo użytkownik w UI, a połączenie zewnętrzne w profilu `brief` widzi tylko odczyt, edycję i wersje briefu'),
    );
  });

  it('get_patch and mark_patch_applied: rest is direct, with no reason and no via', () => {
    registerCoreOperations();
    for (const name of ['get_patch', 'mark_patch_applied']) {
      expect(kinds(name), name).toBe('D/N/N/D');
      expect(CATALOG.require(name).channels.rest, name).toEqual({ kind: 'direct' });
    }
  });

  it('run_turn and search_link_targets: the via target is its own field and the reason does not open with "via"', () => {
    registerCoreOperations();
    const run = CATALOG.require('run_turn').channels.internal;
    expect(run).toMatchObject({ kind: 'via', operation: 'spawn_child_turn' });
    const search = CATALOG.require('search_link_targets').channels;
    for (const channel of ['internal', 'cli', 'mcp'] as const) {
      expect(search[channel], channel).toMatchObject({ kind: 'via', operation: 'search_pages' });
    }
    expect(kinds('run_turn')).toBe('V/N/N/N');
    expect(kinds('search_link_targets')).toBe('V/V/V/D');
  });

  it('no via reason in the catalogue opens with "via <operation> —"', () => {
    registerCoreOperations();
    for (const op of CATALOG.list()) {
      for (const channel of CHANNELS) {
        const cell = op.channels[channel];
        if (cell.kind === 'via') expect(cell.reason, `${op.name}.${channel}`).not.toMatch(/^via\s/);
      }
    }
  });
});

/**
 * 2.1.46 — the M17 shadow comparison (record `shadow-diff`): one row, rendered
 * only by its REST route `GET /api/shadow-diff`. Its behaviour (modes, flags,
 * refusals, read-only) is tested against a real repository next to the route
 * (`src/server/routes/shadow-diff.test.ts`).
 */
describe('the 2.1.46 shadow_diff row', () => {
  it('[entity:shadow-diff] shadow_diff: project, direct, internal/cli/mcp n/a with the record\'s reason, rest direct (GET /api/shadow-diff), no effects, idempotent, no content input, codes SHADOW_NOT_FOUND / GIT_UNAVAILABLE / VALIDATION once each, rules error-code-once + echo-free (nie mutuje), no renderings, addressed by the shadow id', () => {
    registerCoreOperations();
    const op = CATALOG.require('shadow_diff');
    const reason = 'w tej iteracji wyłącznie podgląd w interfejsie; renderowanie agentowe odłożone (przegląd otwarty)';
    expect(op.scope).toBe('project');
    expect(op.mediation).toBe('direct');
    expect(op.opClass).toBe('read');
    expect(op.channels).toEqual({ internal: na(reason), cli: na(reason), mcp: na(reason), rest: direct() });
    expect(op.sideEffects).toEqual(['none']);
    expect(op.idempotent).toBe(true);
    expect(op.contentInput).toBeUndefined();
    expect([...op.errorCodes].sort()).toEqual(['GIT_UNAVAILABLE', 'SHADOW_NOT_FOUND', 'VALIDATION']);
    expect(op.rules).toEqual([{ id: 'error-code-once' }, { id: 'echo-free', exclusion: 'nie mutuje' }]);
    expect(op.renderings).toBeUndefined();
    expect(Object.keys(op.inputSchema)).toEqual(['ref']);
    // The REST rendering of its two own codes.
    expect(httpStatusForCode('SHADOW_NOT_FOUND')).toBe(404);
    expect(httpStatusForCode('GIT_UNAVAILABLE')).toBe(400);
    expect(httpStatusForCode('VALIDATION')).toBe(400);
  });
});

/**
 * 2.1.47 — the M17 shadow acceptance (record `accept-shadow`): one row, rendered
 * only by its REST route `POST /api/shadow-accept`. Its behaviour (guard order,
 * rollback, the variant of `createRelease`) is tested against a real repository
 * and DB next to the route (`src/server/routes/shadow-accept.test.ts`).
 */
describe('the 2.1.47 accept_shadow row', () => {
  it('[entity:accept-shadow] accept_shadow: project, direct, write, internal/cli/mcp n/a with the record\'s reason, rest direct (POST /api/shadow-accept), effects file+db+ui-notify, not idempotent, content n/a, the record\'s 17 codes once each with their REST statuses, rules destructive-declared + operation-only-write (excluded) + error-code-once + echo-free, no renderings, input ref + name + description + both preview SHAs', () => {
    registerCoreOperations();
    const op = CATALOG.require('accept_shadow');
    const reason = 'w tej iteracji wyłącznie interfejs; kanał agenta i wiersz poleceń odłożone (przegląd otwarty)';
    expect(op.scope).toBe('project');
    expect(op.mediation).toBe('direct');
    expect(op.opClass).toBe('write');
    expect(op.channels).toEqual({ internal: na(reason), cli: na(reason), mcp: na(reason), rest: direct() });
    expect([...op.sideEffects].sort()).toEqual(['db', 'file', 'ui-notify']);
    expect(op.idempotent).toBe(false);
    expect(op.contentInput).toBe('n/a');
    expect(op.renderings).toBeUndefined();
    expect(Object.keys(op.inputSchema)).toEqual(['ref', 'name', 'description', 'expectedTipSha', 'expectedHeadSha']);
    expect(op.rules).toEqual([
      { id: 'destructive-declared' },
      { id: 'operation-only-write', exclusion: 'pliki zmienia scalenie gita, nie zapis operacji; capture i reindeks domyka sekwencja in-band' },
      { id: 'error-code-once' },
      { id: 'echo-free' },
    ]);
    const statuses: Record<string, number> = {
      VALIDATION: 400,
      RELEASE_NAME_CONFLICT: 409,
      RELEASE_NAME_RESERVED: 400,
      RELEASE_DESCRIPTION_REQUIRED: 400,
      RELEASE_DESCRIPTION_TOO_LONG: 400,
      GIT_UNAVAILABLE: 400,
      SHADOW_NOT_FOUND: 404,
      ACCEPT_NO_BRANCH: 409,
      ACCEPT_TARGET_NOT_CURRENT: 409,
      ACCEPT_BUSY: 409,
      ACCEPT_STALE: 409,
      ACCEPT_DIRTY: 409,
      ACCEPT_OUTSIDE_SPEC: 409,
      ACCEPT_RELEASES_IN_SHADOW: 409,
      ACCEPT_CONFLICTS: 409,
      ACCEPT_FAILED: 500,
      ACCEPT_ABORT_FAILED: 500,
    };
    expect([...op.errorCodes].sort()).toEqual(Object.keys(statuses).sort());
    expect(new Set(op.errorCodes).size).toBe(op.errorCodes.length);
    for (const [code, status] of Object.entries(statuses)) expect(httpStatusForCode(code), code).toBe(status);
  });
});
