import { describe, it, expect } from 'vitest';
import {
  EFFECT,
  SettingsRegistrationError,
  assembleSettings,
  cardScope,
  effectMessagesFor,
  parseLines,
  type SettingsCardDecl,
  type SettingsElementDecl,
} from './registry.js';

const card = (anchor: string, group: SettingsCardDecl['group'], weight: number, owner = 'm'): SettingsCardDecl => ({
  anchor,
  title: anchor,
  group,
  weight,
  owner,
});
const element = (id: string, cardAnchor: string, weight: number, extra: Partial<SettingsElementDecl> = {}): SettingsElementDecl => ({
  id,
  card: cardAnchor,
  weight,
  kind: 'toggle',
  owner: 'm',
  ...extra,
});

describe('settings card registry (0.2.113)', () => {
  it('orders by group, then card weight, then element weight — declaration order is irrelevant', () => {
    const page = assembleSettings([
      { cards: [card('danger-zone', 'System', 90), card('agent', 'Agent', 10)] },
      { cards: [card('user-section', 'Account', 10), card('about', 'System', 10), card('appearance', 'Account', 20)] },
      { elements: [element('b', 'agent', 30), element('a', 'agent', 20)] },
    ], 'project');
    expect(page.map((c) => c.decl.anchor)).toEqual(['user-section', 'appearance', 'agent', 'about', 'danger-zone']);
    expect(page.find((c) => c.decl.anchor === 'agent')!.elements.map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('two cards with one anchor is a registration error naming both owners', () => {
    expect(() =>
      assembleSettings([{ cards: [card('git', 'Project', 30, 'git-sync')] }, { cards: [card('git', 'Project', 31, 'other')] }], 'project'),
    ).toThrow(SettingsRegistrationError);
    expect(() =>
      assembleSettings([{ cards: [card('git', 'Project', 30, 'git-sync')] }, { cards: [card('git', 'Project', 31, 'other')] }], 'project'),
    ).toThrow(/git-sync.*other/);
  });

  it('an anchor must be kebab-case', () => {
    expect(() => assembleSettings([{ cards: [card('Not Kebab', 'System', 1)] }], 'project')).toThrow(SettingsRegistrationError);
  });

  it('an element pointing at a card that does not exist simply does not render — not an error', () => {
    const page = assembleSettings([{ cards: [card('agent', 'Agent', 10)], elements: [element('x', 'nowhere', 10)] }], 'project');
    expect(page).toHaveLength(1);
    expect(page[0]!.elements).toEqual([]);
  });

  it('cards sharing a weight in one group fall back to alphabetical order', () => {
    const page = assembleSettings([
      { cards: [card('zeta', 'Integrations', 100), card('alpha', 'Integrations', 100), card('first', 'Integrations', 10)] },
    ], 'project');
    expect(page.map((c) => c.decl.anchor)).toEqual(['first', 'alpha', 'zeta']);
  });

  it('the toast carries each changed element’s effect message once, and nothing for unchanged ones', () => {
    const elements = [
      element('name', 'project', 10, { configKey: ['name'], effectMessage: EFFECT.newThread }),
      element('language', 'project', 30, { configKey: ['language'], effectMessage: EFFECT.newThread }),
      element('preset', 'agent', 40, { configKey: ['agent', 'claudeUsePreset'], effectMessage: EFFECT.perTurn }),
      element('silent', 'agent', 50, { configKey: ['agent', 'allowedPaths'] }),
    ];
    expect(effectMessagesFor(elements, [['name'], ['language']])).toEqual([EFFECT.newThread]);
    expect(effectMessagesFor(elements, [['agent', 'allowedPaths']])).toEqual([]);
    expect(effectMessagesFor(elements, [['agent', 'claudeUsePreset'], ['name']])).toEqual([EFFECT.newThread, EFFECT.perTurn]);
  });

  it('no effect message names an effect class', () => {
    for (const message of Object.values(EFFECT)) {
      expect(message).not.toMatch(/per-operation|per-turn|new-thread|context-rebuild|przebudowa|nowy-w/i);
    }
  });

  it('[section:7f76eszm] the scope of a card picks its page: a `workspace` card only on the workspace page, a `projekt` card — or one with no scope — only on the project page', () => {
    const contributions = [
      {
        cards: [
          { ...card('appearance', 'Account', 20), scope: 'workspace' as const },
          { ...card('plugin-pool', 'Plugins', 10), scope: 'workspace' as const },
          { ...card('git', 'Project', 30), scope: 'project' as const },
          card('about', 'System', 10),
        ],
        elements: [
          element('theme', 'appearance', 10, { kind: 'custom' }),
          element('enabled', 'git', 10, { configKey: ['git', 'enabled'] }),
        ],
      },
    ];
    const project = assembleSettings(contributions, 'project');
    const workspace = assembleSettings(contributions, 'workspace');
    expect(project.map((c) => c.decl.anchor)).toEqual(['git', 'about']);
    expect(workspace.map((c) => c.decl.anchor)).toEqual(['appearance', 'plugin-pool']);
    // Elements follow their card to its page.
    expect(workspace[0]!.elements.map((e) => e.id)).toEqual(['theme']);
    expect(project[0]!.elements.map((e) => e.id)).toEqual(['enabled']);
    expect(cardScope(card('about', 'System', 10))).toBe('project');
  });

  it('[section:7f76eszm] an anchor is unique on its page: twice on one page is a registration error naming both owners — and so is the same anchor on the other page, since elements attach by anchor alone', () => {
    const twice = [
      { cards: [{ ...card('appearance', 'Account', 20, 'app-shell'), scope: 'workspace' as const }] },
      { cards: [{ ...card('appearance', 'Account', 30, 'other'), scope: 'workspace' as const }] },
    ];
    expect(() => assembleSettings(twice, 'workspace')).toThrow(/app-shell.*other/);
    const acrossPages = [
      { cards: [{ ...card('appearance', 'Account', 20, 'app-shell'), scope: 'workspace' as const }] },
      { cards: [{ ...card('appearance', 'Account', 30, 'other'), scope: 'project' as const }] },
    ];
    expect(() => assembleSettings(acrossPages, 'project')).toThrow(SettingsRegistrationError);
    expect(() => assembleSettings(acrossPages, 'workspace')).toThrow(/app-shell.*other/);
  });

  it('[section:ata1r5sz] an element of a workspace card holds no config key and is an own component — anything else is a registration error', () => {
    const ws = { ...card('appearance', 'Account', 20), scope: 'workspace' as const };
    expect(() =>
      assembleSettings([{ cards: [ws], elements: [element('k', 'appearance', 10, { configKey: ['name'] })] }], 'workspace'),
    ).toThrow(SettingsRegistrationError);
    expect(() =>
      assembleSettings([{ cards: [ws], elements: [element('g', 'appearance', 10, { kind: 'toggle' })] }], 'project'),
    ).toThrow(SettingsRegistrationError);
    expect(() =>
      assembleSettings([{ cards: [ws], elements: [element('c', 'appearance', 10, { kind: 'custom', keys: [['git', 'enabled']] })] }], 'workspace'),
    ).toThrow(/workspace card "#appearance"/);
    expect(() => assembleSettings([{ cards: [{ ...ws, visible: () => true }] }], 'workspace')).toThrow(SettingsRegistrationError);
    expect(
      assembleSettings([{ cards: [ws], elements: [element('ok', 'appearance', 10, { kind: 'custom' })] }], 'workspace')[0]!.elements,
    ).toHaveLength(1);
  });

  it('`lines`: one value per line, trimmed, empty lines dropped', () => {
    expect(parseLines(' /a \n\n/b\n  \n')).toEqual(['/a', '/b']);
  });
});
