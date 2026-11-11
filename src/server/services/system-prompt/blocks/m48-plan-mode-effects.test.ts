import { describe, expect, it } from 'vitest';
import { buildSystemPrompt, type SystemPromptInput } from '../../chat-context.js';
import { composeSystemPrompt } from '../compose.js';
import type { ProjectPluginHost } from '../../../core/plugin-host/types.js';
import type { BriefService } from '../../brief.js';
import type { PatchService } from '../../patch.js';
import type { PlanService } from '../../plan.js';
import type { CapturedMcpServer } from '../../../plugin-runtime/index.js';
import type { RunRemoteDeps } from '../../../runs/run-remote.js';
import type { RunReadDeps } from '../../../runs/run-read.js';
import type { TransagentDispatcher } from '../../../mcp/transagent-tools.js';
import { buildBriefToolsServer } from '../../../mcp/brief-tools.js';
import { buildC4sToolsServer } from '../../../mcp/c4s-tools.js';
import { buildRunToolsServer } from '../../../mcp/run-tools.js';
import { buildTransagentToolsServer } from '../../../mcp/transagent-tools.js';
import { CATALOG } from '../../../operations/catalog.js';
import { effectiveToolClass } from '../../../operations/profile-gate.js';

/*
 * 2.1.82 (M48) — the "Do not call" line of `<claude4spec_plan_mode>` names only
 * the tools whose call would change something plan mode does not allow:
 *
 * - a host tool with a catalog record: class not `read` / `plan` / `peer` AND
 *   effects not `['none']`;
 * - a host tool with no record: never;
 * - a plugin tool: effective class (`effectiveToolClass`) not `read` — an
 *   overlay envelope gives `write` whatever it declares.
 *
 * The inventory is built from the servers the host actually mounts, and each
 * case first pins the catalog facts it rests on, so a drift in the catalog data
 * (a class, an effect) fails here rather than silently moving the list.
 */

const emptyHost = { listEntities: () => [] } as unknown as ProjectPluginHost;

type Inventory = NonNullable<SystemPromptInput['mcpInventory']>;
const mounted = (name: string, server: CapturedMcpServer): Inventory[number] => ({
  name,
  tools: server.tools.map((t) => t.name),
});

function build(contextType: SystemPromptInput['contextType'], mcpInventory: Inventory): string {
  const input: SystemPromptInput = {
    host: emptyHost,
    projectName: 'My Spec',
    cwd: '/tmp/my-spec',
    roots: [{ id: 'pages', name: 'pages', dir: 'pages', builtin: true }],
    currentPagePath: null,
    currentPageBody: null,
    contextType,
    planMode: true,
    mcpInventory,
  };
  // The brief context type's own composition carries no `<claude4spec_plan_mode>`
  // position, so the block builder is rendered on its own there — with the brief
  // thread's real mount as the turn's inventory.
  return contextType === 'brief'
    ? composeSystemPrompt([{ block: 'claude4spec_plan_mode' }], input)
    : buildSystemPrompt(input);
}

/** The tool names of the "Do not call:" line (empty for `(none mounted this turn)`). */
function doNotCall(prompt: string): string[] {
  const line = /^ {2}- Do not call: (.*)$/m.exec(prompt)?.[1];
  expect(line, 'the plan-mode block carries a "Do not call:" line').toBeDefined();
  if (line === '(none mounted this turn)') return [];
  return line!.split(',').map((t) => t.trim());
}

/** The catalog row a host tool is rendered from, by name. */
function row(name: string) {
  const op = CATALOG.get(name);
  expect(op, `${name} has a host catalog row`).toBeDefined();
  return op!;
}

// The real host servers; their handlers are never called here.
const BRIEF_TOOLS = buildBriefToolsServer({
  threadId: 't-brief',
  briefPath: 'briefs/b.md',
  briefService: {} as BriefService,
});
const RUN_TOOLS = buildRunToolsServer({
  deps: {} as RunRemoteDeps,
  readDeps: {} as RunReadDeps,
  threadId: 't-chat',
});
const TRANSAGENT_TOOLS = buildTransagentToolsServer({
  parentThreadId: 't-chat',
  dispatcher: {} as TransagentDispatcher,
  // With the services, the server carries its reads too (`list_briefs` & co.).
  patches: {} as Pick<PatchService, 'listPatches'>,
  briefs: {} as Pick<BriefService, 'listBriefs'>,
  plans: {} as Pick<PlanService, 'listPlans'>,
});
const C4S_TOOLS = buildC4sToolsServer();

const BRIEF_INVENTORY: Inventory = [mounted('brief-tools', BRIEF_TOOLS)];
const TOP_CHAT_INVENTORY: Inventory = [
  mounted('run-tools', RUN_TOOLS),
  mounted('transagent-tools', TRANSAGENT_TOOLS),
  mounted('c4s-tools', C4S_TOOLS),
];

describe('M48 — <claude4spec_plan_mode> "Do not call" by class and effects (2.1.82)', () => {
  it('[ac:ac-m48-do-not-call-ask-poza-lista] `ask` of `c4s-tools` (class `peer`) is not on the list', () => {
    expect(C4S_TOOLS.tools.map((t) => t.name)).toContain('ask');
    expect(row('ask').opClass).toBe('peer');
    // `ask` is off by its class, not by its effects: it does declare some.
    expect(row('ask').sideEffects).not.toEqual(['none']);
    expect(doNotCall(build('chat', [mounted('c4s-tools', C4S_TOOLS)]))).not.toContain('ask');
  });

  it('[ac:ac-m48-do-not-call-get-brief-poza-lista] brief thread: `get_brief` (class `brief`, effects `none`) is not on the list', () => {
    expect(BRIEF_TOOLS.tools.map((t) => t.name)).toContain('get_brief');
    expect(row('get_brief').opClass).toBe('brief');
    expect(row('get_brief').sideEffects).toEqual(['none']);
    expect(doNotCall(build('brief', BRIEF_INVENTORY))).not.toContain('get_brief');
  });

  it('[ac:ac-m48-do-not-call-update-brief-na-liscie] brief thread: `update_brief` (class `brief`, effects other than `none`) is on the list', () => {
    expect(BRIEF_TOOLS.tools.map((t) => t.name)).toContain('update_brief');
    expect(row('update_brief').opClass).toBe('brief');
    expect(row('update_brief').sideEffects).not.toContain('none');
    expect(doNotCall(build('brief', BRIEF_INVENTORY))).toContain('update_brief');
  });

  it('[ac:ac-m48-do-not-call-get-run-poza-lista] top-level chat thread: `get_run` (class `turn`, effects `none`) is not on the list', () => {
    expect(RUN_TOOLS.tools.map((t) => t.name)).toContain('get_run');
    expect(row('get_run').opClass).toBe('turn');
    expect(row('get_run').sideEffects).toEqual(['none']);
    expect(doNotCall(build('chat', TOP_CHAT_INVENTORY))).not.toContain('get_run');
  });

  it('[ac:ac-m48-do-not-call-list-briefs-poza-lista] top-level chat thread: `list_briefs` of `transagent-tools` (effects `none`) is not on the list', () => {
    expect(TRANSAGENT_TOOLS.tools.map((t) => t.name)).toContain('list_briefs');
    expect(row('list_briefs').sideEffects).toEqual(['none']);
    expect(doNotCall(build('chat', TOP_CHAT_INVENTORY))).not.toContain('list_briefs');
  });

  it('[ac:ac-m48-do-not-call-run-remote-na-liscie] top-level chat thread: `run_remote` (class `turn`, effects `db`) is on the list', () => {
    expect(RUN_TOOLS.tools.map((t) => t.name)).toContain('run_remote');
    expect(row('run_remote').opClass).toBe('turn');
    expect(row('run_remote').sideEffects).toEqual(['db']);
    expect(doNotCall(build('chat', TOP_CHAT_INVENTORY))).toContain('run_remote');
  });

  it('[ac:ac-m48-do-not-call-runtransagent-na-liscie] top-level chat thread: `runTransagent` (class `turn`, effects other than `none`) is on the list', () => {
    expect(TRANSAGENT_TOOLS.tools.map((t) => t.name)).toContain('runTransagent');
    // `runTransagent` has no row of its own name: it is the declared `internal`
    // rendering of `spawn_child_turn`, and that row carries its class and effects.
    expect(CATALOG.has('runTransagent')).toBe(false);
    const spawn = CATALOG.list().filter((op) => op.renderings?.internal?.includes('transagent-tools.runTransagent'));
    expect(spawn.map((op) => op.name)).toEqual(['spawn_child_turn']);
    expect(spawn[0]!.opClass).toBe('turn');
    expect(spawn[0]!.sideEffects).not.toContain('none');
    const list = doNotCall(build('chat', TOP_CHAT_INVENTORY));
    expect(list).toContain('runTransagent');
    // The whole top-level chat list: the two delegating tools and the cancel, nothing that only reads.
    expect(list).toEqual(['cancel_run', 'runTransagent', 'run_remote']);
  });

  it('[ac:ac-m48-do-not-call-plugin-read-baza-poza-lista] a plugin tool from a base-layer envelope declaring `operationClass: \'read\'` is not on the list', () => {
    expect(effectiveToolClass({ name: 'grid_read', operationClass: 'read' }, { plugin: true })).toBe('read');
    const prompt = build('chat', [
      { name: 'sheet-tools', tools: ['grid_read', 'grid_write'], plugin: true, operationClasses: { grid_read: 'read' } },
    ]);
    const list = doNotCall(prompt);
    expect(list).not.toContain('grid_read');
    // Negative control: the undeclared tool of the same server gets `write` and is listed.
    expect(list).toEqual(['grid_write']);
  });

  it('[ac:ac-m48-do-not-call-plugin-read-nakladka-na-liscie] a plugin tool from a project-local overlay envelope declaring `operationClass: \'read\'` is on the list (the overlay gives `write`)', () => {
    expect(effectiveToolClass({ name: 'grid_read', operationClass: 'read' }, { plugin: true, overlay: true })).toBe('write');
    const prompt = build('chat', [
      {
        name: 'sheet-tools',
        tools: ['grid_read'],
        plugin: true,
        overlay: true,
        operationClasses: { grid_read: 'read' },
      },
    ]);
    expect(doNotCall(prompt)).toContain('grid_read');
  });
});

describe('the catalog — effects of operations that hand work on (2.1.82)', () => {
  it('`none` never combines with another effect, and no operation of class `turn` that delegates (spawn_child_turn, run_turn, run_remote) or `ask` declares `none`', () => {
    for (const op of CATALOG.list()) {
      if (op.sideEffects.includes('none')) expect(op.sideEffects, op.name).toEqual(['none']);
    }
    for (const name of ['spawn_child_turn', 'run_turn', 'run_remote', 'ask']) {
      expect(row(name).sideEffects, name).not.toContain('none');
    }
  });
});
