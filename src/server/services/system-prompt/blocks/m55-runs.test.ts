import { describe, expect, it } from 'vitest';
import { buildSystemPrompt, type SystemPromptInput } from '../../chat-context.js';
import type { ProjectPluginHost } from '../../../core/plugin-host/types.js';
import { REMOTE_EXECUTION_BLOCK } from './m55-runs.js';

/**
 * 2.1.70 (M55, L16) — `<remote_execution>` (template `szablon-remote-execution`):
 * static text, emitted iff ≥ 1 runner-host record AND `run-tools` mounted, placed
 * in the access band behind `<tooling>` / `<workspace_projects>` and before
 * `<agent_path_scope>`. The turn-level AC cases live in `routes/agent-turn.test.ts`.
 */

const host = { listEntities: () => [] } as unknown as ProjectPluginHost;

function build(overrides: Partial<SystemPromptInput>): string {
  return buildSystemPrompt({
    host,
    projectName: 'Shop',
    cwd: '/tmp/shop',
    roots: [{ id: 'pages', name: 'pages', dir: 'pages', builtin: true }],
    currentPagePath: null,
    currentPageBody: null,
    contextType: 'chat',
    mcpInventory: [
      { name: 'c4s-tools', tools: ['ask'] },
      { name: 'run-tools', tools: ['run_remote', 'get_run', 'cancel_run'] },
    ],
    workspaceName: 'acme',
    workspaceProjects: [{ id: 'billing', name: 'Billing' }],
    runnerHostCount: 1,
    agentPathScope: { allowedPaths: [], disallowedPaths: [], artifactDenyDirs: ['/tmp/shop/.claude4spec'], pageRootDirs: [] },
    ...overrides,
  });
}

describe('<remote_execution> (M55, 2.1.70)', () => {
  it('[entity:szablon-remote-execution] renders the template verbatim: a bare element, intro, then Starting, Reporting, Continuing, Never', () => {
    const out = build({});
    expect(out).toContain(REMOTE_EXECUTION_BLOCK);
    const lines = REMOTE_EXECUTION_BLOCK.split('\n');
    expect(lines[0]).toBe('<remote_execution>');
    expect(lines.at(-1)).toBe('</remote_execution>');
    expect(REMOTE_EXECUTION_BLOCK).not.toMatch(/\{[a-zA-Z_]+\}/);
    const heads = ['Starting', 'Reporting — only when asked', 'Continuing', 'Never'].map((h) => lines.indexOf(h));
    expect(heads.every((i) => i > 0)).toBe(true);
    expect([...heads].sort((a, b) => a - b)).toEqual(heads);
  });

  it('stands behind <workspace_projects> and before <agent_path_scope>', () => {
    const out = build({});
    const at = (tag: string) => out.indexOf(`<${tag}`);
    expect(at('workspace_projects')).toBeGreaterThan(at('tooling'));
    expect(at('remote_execution')).toBeGreaterThan(at('workspace_projects'));
    expect(at('agent_path_scope')).toBeGreaterThan(at('remote_execution'));
  });

  it('stands behind <tooling> when <workspace_projects> does not render', () => {
    const out = build({ workspaceProjects: [] });
    expect(out).not.toContain('<workspace_projects');
    const at = (tag: string) => out.indexOf(`<${tag}`);
    expect(at('remote_execution')).toBeGreaterThan(at('tooling'));
    expect(at('agent_path_scope')).toBeGreaterThan(at('remote_execution'));
  });

  it('is absent with no runner-host record, and absent without run-tools', () => {
    expect(build({ runnerHostCount: 0 })).not.toContain('<remote_execution>');
    expect(build({ runnerHostCount: undefined })).not.toContain('<remote_execution>');
    expect(build({ mcpInventory: [{ name: 'c4s-tools', tools: ['ask'] }] })).not.toContain('<remote_execution>');
  });

  it('is not part of the brief composition', () => {
    expect(build({ contextType: 'brief', brief: null })).not.toContain('<remote_execution>');
  });
});
