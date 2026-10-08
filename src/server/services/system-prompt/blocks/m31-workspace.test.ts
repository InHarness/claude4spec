import { describe, expect, it } from 'vitest';
import { buildSystemPrompt, type SystemPromptInput } from '../../chat-context.js';
import type { ProjectPluginHost } from '../../../core/plugin-host/types.js';

/**
 * 2.1.9 — `<workspace_projects>` (template `szablon-workspace-projects`, M31
 * `qtqqqwfp`): a peer exposed as a skill carries `skill="exposed"`, and the block
 * says such a peer can be attached in project settings by its skill name, which
 * is not its id. The flag comes from the M52 list of exposed projects (the
 * project context sets `PeerProject.skillExposed`), never from a config read here.
 */

const host = { listEntities: () => [] } as unknown as ProjectPluginHost;

function block(overrides: Partial<SystemPromptInput>): string {
  const out = buildSystemPrompt({
    host,
    projectName: 'Shop',
    cwd: '/tmp/shop',
    roots: [{ id: 'pages', name: 'pages', dir: 'pages', builtin: true }],
    currentPagePath: null,
    currentPageBody: null,
    contextType: 'chat',
    mcpInventory: [{ name: 'c4s-tools', tools: ['ask'] }],
    workspaceName: 'acme',
    ...overrides,
  });
  return /<workspace_projects[\s\S]*?<\/workspace_projects>/.exec(out)?.[0] ?? '';
}

describe('<workspace_projects> — skill="exposed" (M31, 2.1.9)', () => {
  it('[entity:szablon-workspace-projects] renders <peer id name description skill="exposed"/> per peer (skill only on an exposed one, empty attributes dropped), the address rule, and the line on exposed peers', () => {
    const out = block({
      workspaceProjects: [
        { id: 'billing', name: 'Billing API', description: 'Money in, money out.', skillExposed: true },
        { id: 'auth', name: 'Auth' },
      ],
    });
    expect(out.split('\n')).toEqual([
      '<workspace_projects workspace="acme">',
      '  <peer id="billing" name="Billing API" description="Money in, money out." skill="exposed"/>',
      '  <peer id="auth" name="Auth"/>',
      "  Pass a peer's `id` as the `project` argument of `ask` — it is the only address of a project. `name` is the peer's own label for itself and is NOT an address.",
      '  A peer marked skill="exposed" can also be connected as a skill in project settings; its skill name is not its id.',
      '</workspace_projects>',
    ]);
    // The attribute addresses nothing and never carries a path or the skill name.
    expect(out).not.toMatch(/skill="(?!exposed")/);
  });
});
