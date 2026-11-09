/**
 * 2.1.77 — M26 `7f76eszm`: the ACTIVE card/element registry. A card or element
 * whose `Wymaga możliwości` the project does not meet is skipped at assembly: the
 * card does not render, nor its anchor; an element inherits its card's requirement.
 * Workspace cards never read the capability set.
 */
import { describe, expect, it } from 'vitest';
import { assembleSettings, SettingsRegistrationError, type SettingsContribution } from './registry.js';

const contribution: SettingsContribution = {
  cards: [
    { anchor: 'plain', title: 'Plain', group: 'Project', weight: 10, owner: 'a' },
    { anchor: 'gated', title: 'Gated', group: 'Project', weight: 20, owner: 'b', requires: ['entities'] },
    { anchor: 'ws', title: 'Workspace', group: 'System', weight: 10, owner: 'c', scope: 'workspace' },
  ],
  elements: [
    { id: 'p1', card: 'plain', weight: 10, kind: 'text', owner: 'a', configKey: ['name'] },
    { id: 'p2', card: 'plain', weight: 20, kind: 'toggle', owner: 'a', configKey: ['x'], requires: ['briefs'] },
    { id: 'g1', card: 'gated', weight: 10, kind: 'text', owner: 'b', configKey: ['y'] },
  ],
};

const anchors = (caps?: ReadonlySet<string>) =>
  assembleSettings([contribution], 'project', caps).map((c) => [c.decl.anchor, c.elements.map((e) => e.id)]);

describe('assembleSettings — capability requirements (2.1.77)', () => {
  it('without a capability set nothing is filtered', () => {
    expect(anchors()).toEqual([
      ['plain', ['p1', 'p2']],
      ['gated', ['g1']],
    ]);
  });

  it('skips the card (and its elements) and the element whose requirements are unmet', () => {
    expect(anchors(new Set())).toEqual([['plain', ['p1']]]);
    expect(anchors(new Set(['entities']))).toEqual([
      ['plain', ['p1']],
      ['gated', ['g1']],
    ]);
    expect(anchors(new Set(['entities', 'briefs']))).toEqual([
      ['plain', ['p1', 'p2']],
      ['gated', ['g1']],
    ]);
  });

  it('workspace cards ignore the capability set', () => {
    const ws = assembleSettings([contribution], 'workspace', new Set());
    expect(ws.map((c) => c.decl.anchor)).toEqual(['ws']);
  });

  it('an inactive card still counts for anchor uniqueness', () => {
    const dup: SettingsContribution = {
      cards: [
        { anchor: 'same', title: 'A', group: 'Project', weight: 1, owner: 'a', requires: ['entities'] },
        { anchor: 'same', title: 'B', group: 'Project', weight: 2, owner: 'b' },
      ],
    };
    expect(() => assembleSettings([dup], 'project', new Set())).toThrow(SettingsRegistrationError);
  });
});
