import { describe, it, expect } from 'vitest';
import {
  EFFECT,
  SettingsRegistrationError,
  assembleSettings,
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
    ]);
    expect(page.map((c) => c.decl.anchor)).toEqual(['user-section', 'appearance', 'agent', 'about', 'danger-zone']);
    expect(page.find((c) => c.decl.anchor === 'agent')!.elements.map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('two cards with one anchor is a registration error naming both owners', () => {
    expect(() =>
      assembleSettings([{ cards: [card('git', 'Project', 30, 'git-sync')] }, { cards: [card('git', 'Project', 31, 'other')] }]),
    ).toThrow(SettingsRegistrationError);
    expect(() =>
      assembleSettings([{ cards: [card('git', 'Project', 30, 'git-sync')] }, { cards: [card('git', 'Project', 31, 'other')] }]),
    ).toThrow(/git-sync.*other/);
  });

  it('an anchor must be kebab-case', () => {
    expect(() => assembleSettings([{ cards: [card('Not Kebab', 'System', 1)] }])).toThrow(SettingsRegistrationError);
  });

  it('an element pointing at a card that does not exist simply does not render — not an error', () => {
    const page = assembleSettings([{ cards: [card('agent', 'Agent', 10)], elements: [element('x', 'nowhere', 10)] }]);
    expect(page).toHaveLength(1);
    expect(page[0]!.elements).toEqual([]);
  });

  it('plugin cards share a weight and fall back to alphabetical order', () => {
    const page = assembleSettings([
      { cards: [card('plugin-zeta', 'Plugins', 100), card('plugin-alpha', 'Plugins', 100), card('plugin-pool', 'Plugins', 10)] },
    ]);
    expect(page.map((c) => c.decl.anchor)).toEqual(['plugin-pool', 'plugin-alpha', 'plugin-zeta']);
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

  it('`lines`: one value per line, trimmed, empty lines dropped', () => {
    expect(parseLines(' /a \n\n/b\n  \n')).toEqual(['/a', '/b']);
  });
});
