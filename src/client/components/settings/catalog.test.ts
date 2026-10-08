import { describe, it, expect } from 'vitest';
import { assembleSettings, parseLines, type CardDraft, type ConfigKeyPath, type ElementContext } from './registry.js';
import { SUPPORTED_LANGUAGES } from '../../../shared/languages.js';
import type { ConfigResponse } from '../../lib/api.js';
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
      // 2.1.8: the artifact *Dir path elements are gone — system roots live in code.
      ['roots', 'custom'],
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

  /** A draft over one value of `agent.disableDirectFilesystemAccess` (undefined = absent from the file). */
  const ctxWithBlock = (block: boolean | undefined): ElementContext => {
    const draft = {
      get: (key: ConfigKeyPath) =>
        key.join('.') === 'agent.disableDirectFilesystemAccess' ? block : undefined,
    } as unknown as CardDraft;
    return { config: { agent: {} } as unknown as ConfigResponse, draft };
  };
  const agentElement = (id: string) => byAnchor.get('agent')!.elements.find((e) => e.id === id)!;

  it('[ac:ac-ekran-m26-directories-blokuje-przycisk] the Directories card has one element, Roots — no plans/briefs/patches/entities/releases directory fields', () => {
    const elements = byAnchor.get('directories')!.elements;
    expect(elements.map((e) => e.id)).toEqual(['roots']);
    const keys = elements.flatMap((e) => [...(e.configKey ? [e.configKey] : []), ...(e.keys ?? [])]).map((k) => k.join('.'));
    expect(keys).toEqual(['roots']);
    for (const legacy of ['plansDir', 'briefsDir', 'patchesDir', 'entitiesDir', 'releasesDir']) {
      expect(page.flatMap((c) => c.elements).some((e) => e.configKey?.[0] === legacy)).toBe(false);
    }
  });

  it('[ac:ac-m26-sekcja-agent-settings-zawiera-d] the Agent card has the conversationalLanguage dropdown and the disableDirectFilesystemAccess checkbox, ticked when the field is absent', () => {
    const lang = agentElement('conversational-language');
    expect(lang.kind).toBe('select');
    expect(lang.configKey).toEqual(['agent', 'conversationalLanguage']);
    expect(lang.useOptions!()!.map((o) => o.value)).toEqual([...SUPPORTED_LANGUAGES]);
    const block = agentElement('block-direct-file-access');
    expect(block.kind).toBe('toggle');
    expect(block.configKey).toEqual(['agent', 'disableDirectFilesystemAccess']);
    expect(block.baseline!({ agent: {} } as unknown as ConfigResponse)).toBe(true);
    expect(block.baseline!({ agent: { disableDirectFilesystemAccess: false } } as unknown as ConfigResponse)).toBe(false);
  });

  it('[ac:ac-m26-sekcja-project-settings-zawiera-2] the Project card has a language dropdown: SUPPORTED_LANGUAGES plus "None" saving null', () => {
    const lang = byAnchor.get('project')!.elements.find((e) => e.id === 'language')!;
    expect(lang.kind).toBe('select');
    expect(lang.configKey).toEqual(['language']);
    expect(lang.nullOption).toBe('None');
    expect(lang.useOptions!()!.map((o) => o.value)).toEqual([...SUPPORTED_LANGUAGES]);
  });

  it('[ac:ac-textarea-allowed-disallowed-paths-sekcj] ALLOWED/DISALLOWED PATHS hide while the checkbox is ticked (absent = ticked) and parse split-by-line + trim + drop empty', () => {
    for (const id of ['allowed-paths', 'disallowed-paths']) {
      const el = agentElement(id);
      expect(el.kind, id).toBe('lines');
      expect(el.visible!(ctxWithBlock(undefined)), id).toBe(false);
      expect(el.visible!(ctxWithBlock(true)), id).toBe(false);
      expect(el.visible!(ctxWithBlock(false)), id).toBe(true);
    }
    expect(parseLines('  /a/b  \n\n /c \n   \n')).toEqual(['/a/b', '/c']);
  });
});
