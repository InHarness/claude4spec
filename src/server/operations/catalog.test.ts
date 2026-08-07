import { describe, expect, it } from 'vitest';
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

  it('declares every M39 read operation with full four-channel parity and zero n/a', () => {
    const M39 = [
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
      'list_tags',
      'find_references',
      'check_consistency',
      'resolve_identity',
    ];
    expect(M39).toHaveLength(14);
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

  it('`file_patch` is not idempotent — two filings of one drift are two files', () => {
    expect(CATALOG.require('file_patch').idempotent).toBe(false);
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
    expect(profileAdmits('brief', CATALOG.require('file_patch'))).toBe(true);
    expect(profileAdmits('brief', CATALOG.require('list_entities'))).toBe(true);
    expect(profileAdmits('brief', CATALOG.require('create_entities'))).toBe(false);
  });

  it('the mounted server set is DERIVED from the admitted classes, not written beside them', () => {
    // These four reproduce the pre-0.2.13 hand-written registry rows exactly —
    // the derivation is behaviour-preserving, which is what makes it safe.
    expect(mcpServerSetForProfile('chat')).toEqual({
      pluginServers: 'all',
      planTools: true,
      briefTools: false,
      c4sTools: true,
      transagentTools: true,
    });
    expect(mcpServerSetForProfile('brief')).toEqual({
      pluginServers: 'release-only',
      planTools: false,
      briefTools: true,
      c4sTools: false,
      transagentTools: false,
    });
    expect(mcpServerSetForProfile('patch')).toEqual(mcpServerSetForProfile('chat'));
    expect(mcpServerSetForProfile('ask')).toEqual({
      pluginServers: 'all',
      planTools: true,
      briefTools: false,
      c4sTools: false,
      transagentTools: false,
    });
  });

  it('`brief` is the profile that forces an explicit brief-addressing parameter', () => {
    expect(PROFILES.brief.requiresExplicitBriefTarget).toBe(true);
    for (const p of ['chat', 'ask', 'patch'] as const) {
      expect(PROFILES[p].requiresExplicitBriefTarget).toBe(false);
    }
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
    expect(CATALOG.has('runTransagent')).toBe(false);
    expect(toolAdmittedByProfile('brief', 'runTransagent')).toBe(true);
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
     * 0.2.13 makes it urgent rather than theoretical: the `mcp.json` this
     * release generates for every project asks for `?profile=ask`, so that
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
     * 0.2.13 item 28. `page-tools` is host-owned, so without these four rows the
     * gate's permissive default would hand a consulted peer — and, through the
     * generated `mcp.json`, every editor the user opens — the ability to
     * overwrite any page in the specification it was asked a question about.
     *
     * The whole server, not a subset: unlike `release-tools`, every operation on
     * it writes, so `ask` and `brief` are left with nothing and the server is
     * dropped rather than mounted empty.
     */
    const pageTools = ['create_page', 'update_page', 'delete_page', 'update_section'].map((name) => ({
      name,
      description: '',
      inputSchema: {},
      handler: async () => ({}),
    }));

    for (const profile of ['ask', 'brief'] as const) {
      expect(withheldTools(profile, pageTools).sort(), profile).toEqual([
        'create_page',
        'delete_page',
        'update_page',
        'update_section',
      ]);
    }
    // The profiles that author a specification keep all four.
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
});
