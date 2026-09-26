import { describe, it, expect } from 'vitest';
import { assembleSettings } from './registry.js';
import { STATIC_SETTINGS_CONTRIBUTIONS } from './SettingsPage.js';

/**
 * 0.2.113 §1.6 — the card catalog after the move to owning modules. The page is
 * assembled from declarations, so the catalog is checkable without a browser.
 */
describe('/settings card catalog (0.2.113 §1.6)', () => {
  const page = assembleSettings(STATIC_SETTINGS_CONTRIBUTIONS);
  const byAnchor = new Map(page.map((c) => [c.decl.anchor, c]));

  it('renders the core cards in group → weight order', () => {
    expect(page.map((c) => c.decl.anchor)).toEqual([
      'user-section',
      'appearance',
      'project',
      'remote-project',
      'git',
      'directories',
      'entities',
      'external-integrations',
      'plugin-pool',
      'agent',
      'about',
      'index-status',
      'danger-zone',
    ]);
  });

  it('the settings module owns only About and Index status', () => {
    expect(page.filter((c) => c.decl.owner === 'settings').map((c) => c.decl.anchor)).toEqual(['about', 'index-status']);
  });

  it('places each element where §1.6 says, in weight order', () => {
    expect(byAnchor.get('project')!.elements.map((e) => [e.id, e.kind])).toEqual([
      ['name', 'text'],
      ['description', 'textarea'],
      ['language', 'select'],
      ['writing-style', 'select'],
    ]);
    expect(byAnchor.get('directories')!.elements.map((e) => [e.id, e.kind])).toEqual([
      ['roots', 'custom'],
      ['plansDir', 'path'],
      ['briefsDir', 'path'],
      ['patchesDir', 'path'],
      ['entitiesDir', 'path'],
      ['releasesDir', 'path'],
    ]);
    expect(byAnchor.get('agent')!.elements.map((e) => e.id)).toEqual([
      'conversational-language',
      'block-direct-file-access',
      'claude-use-preset',
      'file-access-enforcement',
      'allowed-paths',
      'always-excluded',
      'disallowed-paths',
      'anthropic-api-key',
    ]);
    expect(byAnchor.get('external-integrations')!.elements.map((e) => e.id)).toEqual(['agent-skills', 'mcp-connection']);
  });

  it('only file-backed cards get a [Save] — External Integrations never does', () => {
    const fileBacked = (anchor: string) =>
      byAnchor.get(anchor)!.elements.some((e) => e.configKey !== undefined || (e.keys?.length ?? 0) > 0);
    expect(['project', 'directories', 'git', 'entities', 'agent'].every(fileBacked)).toBe(true);
    expect(
      ['user-section', 'appearance', 'remote-project', 'external-integrations', 'plugin-pool', 'about', 'index-status', 'danger-zone'].some(
        fileBacked,
      ),
    ).toBe(false);
  });

  it('every file-backed Project/Agent element names when it acts — or deliberately nothing', () => {
    const project = byAnchor.get('project')!.elements;
    expect(project.every((e) => e.effectMessage === 'Applies from the next new conversation.')).toBe(true);
    const preset = byAnchor.get('agent')!.elements.find((e) => e.id === 'claude-use-preset')!;
    expect(preset.effectMessage).toBe('Applies from the next agent turn, also in ongoing conversations.');
  });
});
