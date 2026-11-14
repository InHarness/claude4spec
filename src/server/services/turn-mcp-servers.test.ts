import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createMcpServer, mcpTool } from '../plugin-runtime/index.js';
import type { McpServerFactory } from '../../shared/plugin-host/mcp.js';
import { TOOL_GROUPS } from '@inharness-ai/agent-adapters';
import { CONTEXT_TYPE_REGISTRY } from './chat-context.js';
import {
  CONTEXT_TYPE_ROWS,
  ContextTypeRegistryError,
  defaultContextType,
  effectivePlanMode,
  projectContextTypeRows,
  rowBuiltinGroups,
  validateContextTypeRegistry,
} from './context-types/registry.js';
import type { ContextTypeRow } from './context-types/row.js';
import { HOST_PROJECT_TYPE_ENTRIES } from '../project-types/entries.js';
import { assembleTurnMcpServers, type PoolSelector, type TurnServerEntry } from './turn-mcp-servers.js';

/**
 * M44 `317cwhlj` / `3f5ej79s` — the three steps of the turn argument, on the pure
 * assembly the turn handler calls. The fixtures are real `createMcpServer`
 * handles whose tool names are real catalog rows (`list_tags` / `find_references`
 * read-class, `create_tag` write-class), so the profile gate classifies them the
 * way it classifies the production servers.
 */
function server(name: string, tools: string[]): McpServerFactory {
  return createMcpServer({
    name,
    tools: tools.map((t) =>
      mcpTool(t, `${t} fixture`, { x: z.string().optional() }, async () => ({
        content: [{ type: 'text' as const, text: t }],
      })),
    ),
  }) as unknown as McpServerFactory;
}

/** The host pool's factories, by name — each call builds a fresh server. */
const POOL_FACTORIES: ReadonlyArray<readonly [string, string[]]> = [
  ['entity-tools', ['find_references']],
  ['reference-tools', ['list_tags', 'create_tag']],
  ['release-tools', ['list_tags']],
];

/**
 * The host pool as `ProjectPluginHost.buildMcpServers({ include })` hands it
 * over: the selector is applied BEFORE a factory runs, exactly as the real host
 * does, and `built` records every factory that ran.
 */
function hostPool(extra: ReadonlyArray<readonly [string, string[]]> = []) {
  const built: string[] = [];
  const buildPool = (include: PoolSelector): TurnServerEntry[] =>
    [...POOL_FACTORIES, ...extra]
      .filter(([name]) => include(name))
      .map(([name, toolNames]) => {
        built.push(name);
        return { name, server: server(name, toolNames) };
      });
  return { built, buildPool };
}

type Ct = 'chat' | 'brief' | 'patch' | 'ask';

/** Every handler server the turn can build, each a real fixture (read-class tools). */
const HANDLER_NAMES = [
  'plan-tools', 'brief-tools', 'patch-tools', 'c4s-tools', 'transagent-tools',
  'spec-skill-tools', 'run-tools', 'workspace-tools', 'skill-tools',
];
function handlerServers(): Record<string, () => McpServerFactory> {
  return Object.fromEntries(HANDLER_NAMES.map((n) => [n, () => server(n, ['find_references'])]));
}

function assemble(row: ContextTypeRow, opts: { parent?: string | null; extra?: ReadonlyArray<readonly [string, string[]]>; plugin?: string[] } = {}) {
  const pool = hostPool(opts.extra);
  const out = assembleTurnMcpServers({
    row,
    turn: { parentThreadId: opts.parent ?? null },
    buildPool: pool.buildPool,
    handlerServers: handlerServers(),
    pluginServerNames: new Set(opts.plugin ?? []),
  });
  return { out, built: pool.built };
}
const mounted = (ct: Ct, opts: Parameters<typeof assemble>[1] = {}) => names(assemble(CONTEXT_TYPE_REGISTRY[ct], opts).out);

function names(entries: readonly TurnServerEntry[]): string[] {
  return entries.map((e) => e.name).sort();
}

function tools(entries: readonly TurnServerEntry[], name: string): string[] | undefined {
  return entries.find((e) => e.name === name)?.server.tools?.map((t) => t.name);
}

describe('assembleTurnMcpServers — base set ∪ the row\'s Serwery, owner conditions, profile gate (M44 2.1.88)', () => {
  it('[ac:ac-serwer-skill-tools-jest-zamontowany-w] skill-tools is mounted in every value of the registry', () => {
    for (const row of CONTEXT_TYPE_ROWS) {
      expect(names(assemble(row).out), row.value).toContain('skill-tools');
      expect(names(assemble(row, { parent: 'p' }).out), `${row.value} child`).toContain('skill-tools');
    }
  });

  it('[ac:ac-serwer-spec-skill-tools-jest-zamontow] spec-skill-tools is mounted in a thread of a value whose row names it, and in no other', () => {
    for (const row of CONTEXT_TYPE_ROWS) {
      expect(names(assemble(row).out).includes('spec-skill-tools'), row.value).toBe(row.servers.includes('spec-skill-tools'));
    }
    expect(mounted('chat')).toContain('spec-skill-tools');
    expect(mounted('patch')).toContain('spec-skill-tools');
    // A fresh value whose row names it gets it; without the name it does not.
    const fresh: ContextTypeRow = { ...CONTEXT_TYPE_REGISTRY.ask, servers: ['spec-skill-tools'] };
    expect(names(assemble(fresh).out)).toContain('spec-skill-tools');
  });

  it('[ac:ac-serwer-spoza-zestawu-bazowego-ktorego] a server outside the base set that the row does not name is not mounted — a new value gets the base set only', () => {
    const bare: ContextTypeRow = { ...CONTEXT_TYPE_REGISTRY.chat, servers: [] };
    const { out, built } = assemble(bare);
    expect(names(out)).toEqual(['skill-tools', 'workspace-tools']);
    expect(built).toEqual([]); // no pool factory ran
    // ask names neither c4s-tools, transagent-tools, run-tools nor spec-skill-tools.
    const ask = mounted('ask');
    for (const n of ['c4s-tools', 'transagent-tools', 'run-tools', 'spec-skill-tools', 'brief-tools', 'patch-tools']) {
      expect(ask, n).not.toContain(n);
    }
    // patch names neither transagent-tools nor run-tools.
    expect(mounted('patch')).not.toContain('transagent-tools');
    expect(mounted('patch')).not.toContain('run-tools');
  });

  it('[ac:ac-watek-context-type-brief-ma-zamontowa] a brief thread mounts exactly brief-tools, release-tools, skill-tools and workspace-tools', () => {
    const { out, built } = assemble(CONTEXT_TYPE_REGISTRY.brief, { extra: [['notes-tools', ['find_references']]] });
    expect(names(out)).toEqual(['brief-tools', 'release-tools', 'skill-tools', 'workspace-tools']);
    expect(built).toEqual(['release-tools']); // the other pool factories never ran
  });

  it('[section:7q3ny9bb] pula takes the whole pool, and a row-named or base-set server wins a name collision — its pool factory is never built', () => {
    const { out, built } = assemble(CONTEXT_TYPE_REGISTRY.chat, { extra: [['plan-tools', ['list_tags']]] });
    expect(names(out)).toEqual(expect.arrayContaining(['entity-tools', 'reference-tools', 'release-tools']));
    expect(out.filter((e) => e.name === 'plan-tools')).toHaveLength(1);
    expect(tools(out, 'plan-tools')).toEqual(['find_references']);
    expect(built).not.toContain('plan-tools');
  });

  it('[section:exchr4q9] transagent-tools and run-tools follow their owners\' condition: top-level only, even where the row names them', () => {
    expect(mounted('chat')).toEqual(expect.arrayContaining(['transagent-tools', 'run-tools']));
    const child = mounted('chat', { parent: 'parent-1' });
    expect(child).not.toContain('transagent-tools');
    expect(child).not.toContain('run-tools');
    // A pool entry under the name does not slip past the condition either.
    expect(mounted('chat', { parent: 'p', extra: [['run-tools', ['find_references']]] })).not.toContain('run-tools');
  });

  it('[ac:ac-narzedzie-klasy-spoza-klasy-operacji] a tool whose class is outside the row\'s Klasy operacji is cut in a thread of that value', () => {
    const ask = assemble(CONTEXT_TYPE_REGISTRY.ask, { extra: [['writes-only', ['create_tag']]] }).out;
    expect(tools(ask, 'reference-tools')).toEqual(['list_tags']);
    expect(names(ask)).not.toContain('writes-only');
    const chat = assemble(CONTEXT_TYPE_REGISTRY.chat).out;
    expect(tools(chat, 'reference-tools')).toEqual(['list_tags', 'create_tag']);
    // Any row: narrowing the column to `read` cuts the write.
    const readOnly: ContextTypeRow = { ...CONTEXT_TYPE_REGISTRY.chat, operationClasses: ['read'] };
    expect(tools(assemble(readOnly).out, 'reference-tools')).toEqual(['list_tags']);
  });

  it('[ac:ac-w-watku-context-type-ask-narzedzie-se-2] in an ask thread a plugin server tool without an operationClass declaration is not available', () => {
    const out = assemble(CONTEXT_TYPE_REGISTRY.ask, { extra: [['notes-tools', ['notes_list']]], plugin: ['notes-tools'] }).out;
    expect(names(out)).not.toContain('notes-tools');
    expect(names(assemble(CONTEXT_TYPE_REGISTRY.chat, { extra: [['notes-tools', ['notes_list']]], plugin: ['notes-tools'] }).out)).toContain('notes-tools');
  });

  it('[ac:ac-w-watku-context-type-ask-narzedzie-se-5] in an ask thread a plugin server registered under a name other than ${type}-tools, without operationClass, is not available', () => {
    const out = assemble(CONTEXT_TYPE_REGISTRY.ask, { extra: [['custom-surface', ['notes_list']]], plugin: ['custom-surface'] }).out;
    expect(names(out)).not.toContain('custom-surface');
  });

  it('[ac:ac-wywolanie-w-profilu-ask-narzedzia-mut] in the ask profile a spec-mutating tool is not mounted, so calling it is an unknown tool', () => {
    const out = assemble(CONTEXT_TYPE_REGISTRY.ask).out;
    const all = out.flatMap((e) => (e.server.tools ?? []).map((t) => t.name));
    expect(all).not.toContain('create_tag');
    expect(all).toContain('list_tags');
  });
});

describe('context-type registry rows (M44 2.1.88)', () => {
  it('[ac:ac-wartosc-wymagajaca-mozliwosci-nieobec] a value requiring a capability the project lacks is not in that project\'s registry', () => {
    const without = projectContextTypeRows(new Set<string>()).map((r) => r.value);
    expect(without).toEqual(['chat', 'ask']);
    const withBriefs = projectContextTypeRows(new Set(['briefs'])).map((r) => r.value);
    expect(withBriefs).toEqual(['chat', 'brief', 'patch', 'ask']);
    const extra: ContextTypeRow = { ...CONTEXT_TYPE_REGISTRY.chat, value: 'chat', entry: [], requiresCapabilities: ['multi-root'] };
    expect(projectContextTypeRows(new Set(['briefs']), [extra])).toEqual([]);
    expect(projectContextTypeRows(new Set(['multi-root']), [extra])).toEqual([extra]);
  });

  it('[ac:ac-watek-context-type-ask-wykonuje-kazda] a value with a pinned plan-mode posture runs every turn with planMode true whatever the thread flag', () => {
    expect(effectivePlanMode(CONTEXT_TYPE_REGISTRY.ask, false)).toBe(true);
    expect(effectivePlanMode(CONTEXT_TYPE_REGISTRY.ask, true)).toBe(true);
    expect(effectivePlanMode(CONTEXT_TYPE_REGISTRY.chat, false)).toBe(false);
    expect(effectivePlanMode(CONTEXT_TYPE_REGISTRY.chat, true)).toBe(true);
    expect(effectivePlanMode({ ...CONTEXT_TYPE_REGISTRY.chat, posture: { kind: 'unavailable', reason: 'x' } }, true)).toBe(false);
  });

  it('[section:zvy49ysg] a thread opened without a type gets the value with Wejście: domyślny', () => {
    expect(defaultContextType()).toBe('chat');
    expect(defaultContextType(new Set<string>())).toBe('chat');
  });

  it('[section:3f5ej79s] Grupy wbudowane: brief takes every group of the agent library, the others none', () => {
    expect(rowBuiltinGroups(CONTEXT_TYPE_REGISTRY.brief)).toEqual([...TOOL_GROUPS]);
    for (const ct of ['chat', 'patch', 'ask'] as const) expect(rowBuiltinGroups(CONTEXT_TYPE_REGISTRY[ct]), ct).toEqual([]);
  });

  it('[section:8rnqx0vu] start-up validation passes for the host project types and refuses each broken invariant', () => {
    expect(() => validateContextTypeRegistry(HOST_PROJECT_TYPE_ENTRIES)).not.toThrow();
    const types = [{ slug: 't', capabilities: ['briefs'] }];
    const rows = (...r: ContextTypeRow[]) => r;
    const chat = CONTEXT_TYPE_REGISTRY.chat;
    const ask = CONTEXT_TYPE_REGISTRY.ask;
    expect(() => validateContextTypeRegistry(types, rows(ask))).toThrow(ContextTypeRegistryError); // no default
    expect(() => validateContextTypeRegistry(types, rows(chat, { ...chat, value: 'patch' }))).toThrow(/exactly one/);
    expect(() => validateContextTypeRegistry(types, rows(chat, ask, { ...ask, value: 'patch' }))).toThrow(/at most one/);
    expect(() => validateContextTypeRegistry(types, rows(chat, { ...ask, operationClasses: 'all' }))).toThrow(/outside \{read, plan\}/);
    expect(() => validateContextTypeRegistry(types, rows(chat, { ...ask, servers: ['c4s-tools'] }))).toThrow(/consultation server/);
    expect(() => validateContextTypeRegistry(types, rows(chat, { ...ask, posture: { kind: 'follow-thread' } }))).toThrow(/pinned or unavailable/);
    expect(() => validateContextTypeRegistry(types, rows(chat, ask, { ...CONTEXT_TYPE_REGISTRY.brief, promptComposition: { own: [] } }))).toThrow(/no recipe/);
  });
});
