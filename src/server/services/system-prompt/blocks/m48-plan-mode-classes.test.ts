import { describe, expect, it, vi } from 'vitest';
import { buildSystemPrompt, type SystemPromptInput } from '../../chat-context.js';
import type { ProjectPluginHost } from '../../../core/plugin-host/types.js';
import type { PlanService } from '../../plan.js';
import type { FileVersionService } from '../../file-version.js';
import { buildPlanToolsServer } from '../../../mcp/plan-tools.js';
import { CATALOG } from '../../../operations/catalog.js';
import * as gate from '../../../operations/profile-gate.js';

/*
 * 2.1.80 (M48, M44) — the "Do not call" line of `<claude4spec_plan_mode>` names
 * only the tools whose EFFECTIVE class is neither `read` nor `plan`, by the rule
 * the profile gate applies (`effectiveToolClass`). Two cases are exempt: the
 * `plan-tools` operations (class `plan`, given only by the host catalog) and a
 * host-server tool with no host-catalog row (no class at all). An undeclared
 * PLUGIN tool still gets `write` and stays on the list.
 *
 * The gate module is wrapped (not replaced) so the test can see that the block
 * builder classifies through the gate's own function rather than its own copy.
 */
vi.mock('../../../operations/profile-gate.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../operations/profile-gate.js')>();
  return { ...actual, effectiveToolClass: vi.fn(actual.effectiveToolClass) };
});

const emptyHost = { listEntities: () => [] } as unknown as ProjectPluginHost;

function build(mcpInventory: SystemPromptInput['mcpInventory']): string {
  return buildSystemPrompt({
    host: emptyHost,
    projectName: 'My Spec',
    cwd: '/tmp/my-spec',
    roots: [{ id: 'pages', name: 'pages', dir: 'pages', builtin: true }],
    currentPagePath: null,
    currentPageBody: null,
    contextType: 'chat',
    planMode: true,
    mcpInventory,
  });
}

/** The tool names of the "Do not call:" line, or `null` when it says `(none mounted this turn)`. */
function doNotCall(prompt: string): string[] | null {
  const line = /^ {2}- Do not call: (.*)$/m.exec(prompt)?.[1];
  expect(line, 'the plan-mode block carries a "Do not call:" line').toBeDefined();
  if (line === '(none mounted this turn)') return null;
  return line!.split(',').map((t) => t.trim());
}

/** The tools the host actually mounts on `plan-tools`, not a hand-written list. */
const PLAN_TOOLS = buildPlanToolsServer({
  threadId: 't-1',
  planService: {} as PlanService,
  pageVersions: {} as FileVersionService,
}).tools.map((t) => t.name);

describe('M48 — <claude4spec_plan_mode> "Do not call" by effective class (2.1.80)', () => {
  it('[ac:ac-w-turze-prowadzonej-w-trybie-planowan-2] a plan-tools tool (class `plan` in the host catalog) is not on the "Do not call" list; a write tool is', () => {
    // Fixture sanity: the mount carries `update_plan`, and every one of its tools
    // has the `plan` class — from the host catalog, the only source of that class.
    expect(PLAN_TOOLS).toContain('update_plan');
    for (const name of PLAN_TOOLS) {
      expect(CATALOG.get(name)?.opClass, name).toBe('plan');
      expect(gate.effectiveToolClass(name), name).toBe('plan');
    }
    const prompt = build([
      { name: 'plan-tools', tools: PLAN_TOOLS },
      { name: 'entity-tools', tools: ['get_entities', 'update_entities'] },
    ]);
    expect(prompt).toContain('<claude4spec_plan_mode>');
    const list = doNotCall(prompt);
    // Negative control: the write tool is listed, so the list is not just empty.
    expect(gate.effectiveToolClass('update_entities')).toBe('write');
    expect(list).toEqual(['update_entities']);
    for (const name of PLAN_TOOLS) expect(list, name).not.toContain(name);
  });

  it('[ac:ac-w-turze-prowadzonej-w-trybie-planowan-3] a host-server tool with no host-catalog row is not on the "Do not call" list; an undeclared plugin tool still is', () => {
    // A host tool the production catalog does not know — a fixture name, the
    // catalog itself is untouched.
    const hostTool = 'zz_fixture_host_probe';
    expect(CATALOG.has(hostTool)).toBe(false);
    // The gate's own rule: no class for an unrecorded host tool, `write` for an
    // undeclared plugin tool.
    expect(gate.effectiveToolClass(hostTool)).toBeUndefined();
    expect(gate.effectiveToolClass('frobnicate_grid', { plugin: true })).toBe('write');
    expect(gate.toolAdmittedByProfile('ask', hostTool)).toBe(true);

    const spy = vi.mocked(gate.effectiveToolClass);
    spy.mockClear();
    const prompt = build([
      { name: 'scratch-tools', tools: [hostTool] },
      { name: 'sheet-tools', tools: ['frobnicate_grid'], plugin: true },
    ]);
    const list = doNotCall(prompt);
    expect(list).not.toContain(hostTool);
    expect(list).toContain('frobnicate_grid');
    // One classifier for the gate and the list: the block builder asks the
    // gate's `effectiveToolClass`, with the facts the gate gets.
    // 2.1.83 — with the server and channel too: the gate resolves a host tool's
    // record by name, else by a declared `<server>.<tool>` rendering.
    expect(spy).toHaveBeenCalledWith(
      { name: hostTool, operationClass: undefined },
      { plugin: false, overlay: false, server: 'scratch-tools', channel: 'internal' },
    );
    expect(spy).toHaveBeenCalledWith(
      { name: 'frobnicate_grid', operationClass: undefined },
      { plugin: true, overlay: false, server: 'sheet-tools', channel: 'internal' },
    );

    // With only the unrecorded host tool mounted, the line falls back to the literal.
    expect(doNotCall(build([{ name: 'scratch-tools', tools: [hostTool] }]))).toBeNull();
  });
});
