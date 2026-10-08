import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ExposedProjectRow } from '../../../shared/spec-skills.js';
import { assembleSettings, type CardDraft, type ConfigKeyPath, type ElementContext } from '../settings/registry.js';
import type { ConfigResponse } from '../../lib/api.js';
import { SPEC_SKILLS_SETTINGS, UsedSkillProjectsList, attachmentMarker, toggleUse } from './specSkillsSettings.js';

/**
 * 2.1.9 — M52 L17 (`1osy2o5r`, `qtq9iusb`): the `#skills` card and its own
 * element "Used skill projects". The list is rendered statically from rows of
 * `GET /api/spec-skills/exposed-projects`.
 */

const ROWS: ExposedProjectRow[] = [
  { name: 'billing-rules', description: 'How billing works.', projectId: 'billing', uses: true, status: 'ok' },
  { name: 'docs', uses: false, status: 'ambiguous' },
  { name: 'ghost', uses: true, status: 'unavailable' },
];

function draftOver(values: Record<string, unknown>): CardDraft {
  return {
    get: (key: ConfigKeyPath) => values[key.join('.')],
    set: () => {},
    error: () => null,
    setLiveError: () => {},
    isDirty: () => false,
    saving: false,
    setBusy: () => {},
  };
}

describe('#skills — Used skill projects (M52 L17, 2.1.9)', () => {
  it('[ac:m52-dangling-attachment-marked-unavailable] a dangling attachment is marked Unavailable on the #skills card (an ambiguous one Ambiguous), and the marker does not block the card', () => {
    expect(attachmentMarker({ status: 'unavailable' })).toBe('Unavailable');
    expect(attachmentMarker({ status: 'ambiguous' })).toBe('Ambiguous');
    expect(attachmentMarker({ status: 'ok' })).toBeNull();
    const html = renderToStaticMarkup(
      createElement(UsedSkillProjectsList, { rows: ROWS, uses: ['billing-rules', 'ghost'], onToggle: () => {} }),
    );
    expect(html).toMatch(/data-skill-name="ghost"[\s\S]*?data-marker="Unavailable"[^>]*>Unavailable</);
    expect(html).toMatch(/data-skill-name="docs"[\s\S]*?data-marker="Ambiguous"[^>]*>Ambiguous</);
    expect(html).not.toMatch(/data-skill-name="billing-rules"[^]*?data-marker[^]*?data-skill-name="docs"/);
    // A marked row is still a live checkbox — the marker never disables it.
    expect(html).not.toContain('disabled');
  });

  it('ticking a row adds its name to skill.uses, unticking removes it — the draft, saved with the card', () => {
    expect(toggleUse(['billing-rules'], 'legal-terms', true)).toEqual(['billing-rules', 'legal-terms']);
    expect(toggleUse(['billing-rules', 'ghost'], 'ghost', false)).toEqual(['billing-rules']);
    expect(toggleUse(['billing-rules'], 'billing-rules', true)).toEqual(['billing-rules']);
    const html = renderToStaticMarkup(createElement(UsedSkillProjectsList, { rows: ROWS, uses: ['billing-rules'], onToggle: () => {} }));
    // Checked by the DRAFT's uses, not by the server's flag.
    expect(html).toMatch(/data-skill-name="billing-rules"[^>]*><input type="checkbox" checked=""/);
    expect(html).toMatch(/data-skill-name="ghost"[^>]*><input type="checkbox" class/);
  });

  it('the card: anchor #skills in the Agent group (weight 20) with its note; exposure fields only while exposed; the tooltip of Skill name', () => {
    const [card] = assembleSettings([SPEC_SKILLS_SETTINGS]);
    expect(card!.decl).toMatchObject({
      anchor: 'skills',
      title: 'Skills',
      group: 'Agent',
      weight: 20,
      description: 'Projects that use this one read it live and read-only.',
    });
    const el = (id: string) => card!.elements.find((e) => e.id === id)!;
    expect(el('skill-exposed').configKey).toEqual(['skill', 'exposed']);
    expect(el('used-skill-projects').keys).toEqual([['skill', 'uses']]);
    expect(el('skill-name').tooltip).toBe('The address other projects in this workspace use to attach this project as a skill.');
    expect(el('skill-entry').effectMessage).toBe('Applies to the next read.');
    expect(el('used-skill-projects').effectMessage).toBe('Applies from the next new conversation.');
    expect(el('skill-scope').useOptions!()!.map((o) => o.value)).toEqual(['writing-style', 'contextual']);
    const config = {} as ConfigResponse;
    const ctx = (exposed: boolean | undefined): ElementContext => ({ config, draft: draftOver({ 'skill.exposed': exposed }) });
    for (const id of ['skill-name', 'skill-description', 'skill-entry', 'skill-scope', 'skill-context-types']) {
      expect(el(id).visible!(ctx(true)), id).toBe(true);
      expect(el(id).visible!(ctx(false)), id).toBe(false);
      expect(el(id).visible!(ctx(undefined)), id).toBe(false);
    }
    // The toggle and the list are always there.
    expect(el('skill-exposed').visible).toBeUndefined();
    expect(el('used-skill-projects').visible).toBeUndefined();
  });
});
