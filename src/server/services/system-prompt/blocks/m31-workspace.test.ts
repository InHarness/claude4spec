import { describe, expect, it } from 'vitest';
import { buildSystemPrompt, type SystemPromptInput } from '../../chat-context.js';
import type { ProjectPluginHost } from '../../../core/plugin-host/types.js';

/**
 * 2.1.77 — `<workspace_projects>` (template `szablon-workspace-projects`, M31
 * `qtqqqwfp`, `gofah0an`): every peer carries `type="…"`, the slug of its project
 * type from the copy in its registry record (the project context sets
 * `PeerProject.type`), written verbatim — an unknown slug too. The 2.1.9
 * `skill="exposed"` marker is gone; the closing line names the peer types that
 * can be connected as a skill.
 */

const host = { listEntities: () => [] } as unknown as ProjectPluginHost;

const TEMPLATE = [
  '<workspace_projects workspace="{nazwa workspace\'u}">',
  '  <peer id="{project-id}" name="{własna etykieta sąsiada}" description="{opis projektu}" type="{slug typu projektu}"/>',
  "  Pass a peer's `id` as the `project` argument of `ask` — it is the only address of a project. `name` is the peer's own label for itself and is NOT an address. A peer of type skill or writing-style can also be connected as a skill in project settings; its skill name is not its id.",
  '</workspace_projects>',
];

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

const PEERS = [
  { id: 'billing', name: 'Billing API', description: 'Money in, money out.', type: 'spec' },
  { id: 'house-style', name: 'House style', type: 'writing-style' },
  { id: 'onboarding', type: 'skill' },
  { id: 'future', name: 'Future', type: 'notebook' },
];

describe('<workspace_projects> — the peer type (M31, 2.1.77)', () => {
  it('[entity:szablon-workspace-projects] renders <peer id name description type/> per peer (the parenthetical note is not rendered) and the address rule with the skill-connection sentence, verbatim', () => {
    const out = block({ workspaceProjects: PEERS.slice(0, 1) });
    const [open, peer, rule, close] = TEMPLATE;
    expect(out.split('\n')).toEqual([
      open!.replace("{nazwa workspace'u}", 'acme'),
      peer!
        .replace('{project-id}', 'billing')
        .replace('{własna etykieta sąsiada}', 'Billing API')
        .replace('{opis projektu}', 'Money in, money out.')
        .replace('{slug typu projektu}', 'spec'),
      rule,
      close,
    ]);
  });

  it('[ac:m31-peer-carries-type-attribute] every <peer> carries `type` with that peer\'s type slug — known types and an unknown slug alike, verbatim', () => {
    const out = block({ workspaceProjects: PEERS });
    const peers = out.split('\n').filter((l) => l.startsWith('  <peer '));
    expect(peers).toEqual([
      '  <peer id="billing" name="Billing API" description="Money in, money out." type="spec"/>',
      '  <peer id="house-style" name="House style" type="writing-style"/>',
      '  <peer id="onboarding" type="skill"/>',
      '  <peer id="future" name="Future" type="notebook"/>',
    ]);
    for (const [i, p] of PEERS.entries()) expect(peers[i]).toContain(` type="${p.type}"`);
  });

  it('[ac:m31-peer-has-no-skill-attribute] no <peer> carries a `skill` attribute, not even a skill or writing-style peer', () => {
    const out = block({ workspaceProjects: PEERS });
    const peers = out.split('\n').filter((l) => l.startsWith('  <peer '));
    expect(peers).toHaveLength(4);
    for (const line of peers) expect(line).not.toMatch(/\sskill="/);
    expect(out).not.toContain('skill="exposed"');
  });
});
