import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, type SystemPromptInput, type PeerProject } from './chat-context.js';
import type { ProjectPluginHost } from '../core/plugin-host/types.js';

// buildSystemPrompt only calls host.listEntities() (no active plugins needed for
// these gating assertions); entityCounts is supplied directly by the caller.
const host = { listEntities: () => [] } as unknown as ProjectPluginHost;

function build(overrides: Partial<SystemPromptInput>): string {
  return buildSystemPrompt({
    host,
    projectName: 'My Spec',
    cwd: '/tmp/my-spec',
    pagesDir: 'pages',
    currentPagePath: null,
    currentPageBody: null,
    pageCount: 0,
    entityCounts: {},
    tagCount: 0,
    sectionCount: 0,
    ...overrides,
  });
}

const PEERS: PeerProject[] = [
  { name: 'Billing API', path: '/ws/billing', description: 'Money in, money out.' },
  { name: 'Auth', path: '/ws/auth' },
];

describe('buildSystemPrompt — <workspace_projects> (0.1.58)', () => {
  it('omits the block when c4sToolsAvailable is false, regardless of peers', () => {
    const out = build({ c4sToolsAvailable: false, workspaceProjects: PEERS, workspaceName: 'acme' });
    expect(out).not.toContain('<workspace_projects workspace=');
  });

  it('omits the block when the peer list is empty', () => {
    const out = build({ c4sToolsAvailable: true, workspaceProjects: [], workspaceName: 'acme' });
    expect(out).not.toContain('<workspace_projects workspace=');
  });

  it('renders the block right after <c4s_tools_usage> and before <project_skill>', () => {
    const out = build({
      c4sToolsAvailable: true,
      workspaceProjects: PEERS,
      workspaceName: 'acme',
      writingStyle: { slug: 'house-style', title: 'House Style' },
    });
    const c4sIdx = out.indexOf('<c4s_tools_usage>');
    const wsIdx = out.indexOf('<workspace_projects');
    const skillIdx = out.indexOf('<project_skill');
    expect(c4sIdx).toBeGreaterThanOrEqual(0);
    expect(wsIdx).toBeGreaterThan(c4sIdx);
    expect(skillIdx).toBeGreaterThan(wsIdx);
    expect(out).toContain('<workspace_projects workspace="acme">');
  });

  it('renders one <peer> per project with the workspace cwd as path', () => {
    const out = build({ c4sToolsAvailable: true, workspaceProjects: PEERS, workspaceName: 'acme' });
    expect(out).toContain('<peer name="Billing API" path="/ws/billing" description="Money in, money out."/>');
  });

  it('drops empty name/description attributes (unreadable peer config → path only)', () => {
    const out = build({ c4sToolsAvailable: true, workspaceProjects: PEERS, workspaceName: 'acme' });
    expect(out).toContain('<peer name="Auth" path="/ws/auth"/>');
  });

  it('never renders the block in a brief frame', () => {
    const out = build({
      contextType: 'brief',
      c4sToolsAvailable: true,
      workspaceProjects: PEERS,
      workspaceName: 'acme',
      brief: null,
    });
    expect(out).not.toContain('<workspace_projects workspace=');
  });
});
