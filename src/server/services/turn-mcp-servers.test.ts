import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createMcpServer, mcpTool } from '../plugin-runtime/index.js';
import type { McpServerFactory } from '../../shared/plugin-host/mcp.js';
import { CONTEXT_TYPE_REGISTRY } from './chat-context.js';
import {
  assembleTurnMcpServers,
  poolSelector,
  type PoolSelector,
  type TurnServerEntry,
} from './turn-mcp-servers.js';

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

/** Shorthand: the arguments for a context type as the turn handler passes them. */
function argsFor(contextType: 'chat' | 'brief' | 'patch' | 'ask', buildPool: (i: PoolSelector) => TurnServerEntry[]) {
  return { contextType, pluginServers: CONTEXT_TYPE_REGISTRY[contextType].mcp.pluginServers, buildPool };
}

function names(entries: readonly TurnServerEntry[]): string[] {
  return entries.map((e) => e.name).sort();
}

function tools(entries: readonly TurnServerEntry[], name: string): string[] | undefined {
  return entries.find((e) => e.name === name)?.server.tools?.map((t) => t.name);
}

describe('assembleTurnMcpServers — the turn argument in three steps (M44)', () => {
  it('[section:317cwhlj] the handler assembles the whole argument: reference-tools and release-tools arrive from the host pool with the entity servers, not appended on their own', () => {
    const handler: TurnServerEntry[] = [{ name: 'skill-tools', server: server('skill-tools', ['list_tags']) }];
    const out = assembleTurnMcpServers({ ...argsFor('chat', hostPool().buildPool), handlerEntries: handler });
    // Pool servers (entity + host reference/release) and the handler's server — one argument.
    expect(names(out)).toEqual(['entity-tools', 'reference-tools', 'release-tools', 'skill-tools']);
    // With no pool, the handler appends no reference-tools / release-tools of its own.
    const bare = assembleTurnMcpServers({ ...argsFor('chat', () => []), handlerEntries: handler });
    expect(names(bare)).toEqual(['skill-tools']);
  });

  it('[section:3f5ej79s] step 1: the pool is unaware of the context type — the handler narrows it, brief takes only release-tools, every other type the whole pool', () => {
    const brief = hostPool();
    expect(names(assembleTurnMcpServers({ ...argsFor('brief', brief.buildPool), handlerEntries: [] }))).toEqual([
      'release-tools',
    ]);
    for (const contextType of ['chat', 'patch', 'ask'] as const) {
      const pool = hostPool();
      assembleTurnMcpServers({ ...argsFor(contextType, pool.buildPool), handlerEntries: [] });
      expect(pool.built.sort(), contextType).toEqual(['entity-tools', 'reference-tools', 'release-tools']);
    }
  });

  it('[section:3f5ej79s] step 1: a brief turn builds only the pool server it mounts — no other factory runs', () => {
    const pool = hostPool();
    assembleTurnMcpServers({ ...argsFor('brief', pool.buildPool), handlerEntries: [] });
    expect(pool.built).toEqual(['release-tools']);
  });

  it('[section:3f5ej79s] step 1: the narrowing follows the caller\'s registry value, not the context type — release-only narrows even a chat turn', () => {
    const narrowed = hostPool();
    const out = assembleTurnMcpServers({
      contextType: 'chat',
      pluginServers: 'release-only',
      buildPool: narrowed.buildPool,
      handlerEntries: [],
    });
    expect(names(out)).toEqual(['release-tools']);
    expect(narrowed.built).toEqual(['release-tools']);
    // And `all` under brief's gate takes the whole pool from the host.
    const whole = hostPool();
    assembleTurnMcpServers({ contextType: 'brief', pluginServers: 'all', buildPool: whole.buildPool, handlerEntries: [] });
    expect(whole.built.sort()).toEqual(['entity-tools', 'reference-tools', 'release-tools']);
  });

  it('poolSelector: release-only admits only the whitelist, all admits every name, and a shadowed name is never admitted', () => {
    expect(poolSelector('release-only')('release-tools')).toBe(true);
    expect(poolSelector('release-only')('entity-tools')).toBe(false);
    expect(poolSelector('all')('entity-tools')).toBe(true);
    expect(poolSelector('all', new Set(['plan-tools']))('plan-tools')).toBe(false);
    expect(poolSelector('release-only', new Set(['release-tools']))('release-tools')).toBe(false);
  });

  it('[section:3f5ej79s] step 2: on a server-name collision the handler entry wins over the pool entry — one server under the name, the handler\'s, and the pool factory is never built', () => {
    const pool = hostPool([['plan-tools', ['list_tags']]]);
    const handlerPlan = server('plan-tools', ['find_references']);
    const out = assembleTurnMcpServers({
      ...argsFor('chat', pool.buildPool),
      handlerEntries: [{ name: 'plan-tools', server: handlerPlan }],
    });
    expect(out.filter((e) => e.name === 'plan-tools')).toHaveLength(1);
    expect(out.find((e) => e.name === 'plan-tools')!.server).toBe(handlerPlan);
    expect(pool.built).not.toContain('plan-tools');
  });

  it('[section:3f5ej79s] step 3: the profile gate filters tools by operation classes and drops a server left with no tools — ask keeps reads, loses writes', () => {
    // A server whose every tool is a write: nothing survives for `ask`.
    const pool = hostPool([['writes-only', ['create_tag']]]);
    const out = assembleTurnMcpServers({ ...argsFor('ask', pool.buildPool), handlerEntries: [] });
    expect(tools(out, 'reference-tools')).toEqual(['list_tags']);
    expect(names(out)).not.toContain('writes-only');
    // The same pool under `chat` keeps the write.
    const chat = assembleTurnMcpServers({ ...argsFor('chat', hostPool().buildPool), handlerEntries: [] });
    expect(tools(chat, 'reference-tools')).toEqual(['list_tags', 'create_tag']);
  });
});
