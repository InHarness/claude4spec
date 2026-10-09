import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ExposedProjectRow } from '../../../shared/spec-skills.js';
import { assembleSettings, type CardDraft, type ConfigKeyPath, type ElementContext } from '../settings/registry.js';
import type { ConfigResponse } from '../../lib/api.js';
import {
  FORK_CONFLICT_MESSAGE,
  FORK_DONE_MESSAGE,
  ForkWritingStyleControl,
  SPEC_SKILLS_SETTINGS,
  UsedSkillProjectsList,
  attachmentMarker,
  forkFailureMessage,
  forkableWritingStyle,
  toggleUse,
} from './specSkillsSettings.js';
import { ApiError } from '../../lib/api-core.js';
import type { WritingStyleSummary } from '../../../shared/writing-styles.js';

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
    // React's SSR writes `checked` after the other input attributes, so match the
    // row's checkbox tag as a whole, whatever the attribute order.
    const checkbox = (name: string): string => {
      const m = html.match(new RegExp(`data-skill-name="${name}"[^>]*>(<input type="checkbox"[^>]*>)`));
      expect(m, name).not.toBeNull();
      return m![1]!;
    };
    expect(checkbox('billing-rules')).toContain('checked=""');
    expect(checkbox('ghost')).not.toContain('checked');
    expect(checkbox('docs')).not.toContain('checked');
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

/**
 * 2.1.9 — M52 L17 `oqhvnhyf`: "Fork writing style locally" on the `#skills` card,
 * an action outside the card's shared save, calling `POST /api/spec-skills/style-forks`.
 */
describe('#skills — Fork writing style locally (M52 L17, 2.1.9)', () => {
  const style = (slug: string, source: WritingStyleSummary['source']): WritingStyleSummary => ({
    slug,
    title: slug,
    description: '',
    version: 1,
    language: 'en',
    source,
  });

  it('is shown only while the active writing style comes from a plugin (not shadowed by another source)', () => {
    const available = [style('lvs', 'plugin'), style('mine', 'project-rooted'), style('team', 'user')];
    expect(forkableWritingStyle({ active: 'lvs', available })).toBe('lvs');
    // Shadowed: the local copy won the slug, so the list reports another source.
    expect(forkableWritingStyle({ active: 'mine', available })).toBeNull();
    expect(forkableWritingStyle({ active: 'team', available })).toBeNull();
    expect(forkableWritingStyle({ active: null, available })).toBeNull();
    expect(forkableWritingStyle(undefined)).toBeNull();
    const [card] = assembleSettings([SPEC_SKILLS_SETTINGS]);
    const el = card!.elements.find((e) => e.id === 'fork-writing-style')!;
    expect(el).toMatchObject({ kind: 'custom', weight: 80, label: 'Fork writing style locally' });
    // An action, not a config field: no key, so it never joins the card's save.
    expect(el.configKey).toBeUndefined();
    expect(el.keys).toBeUndefined();
  });

  it('states: ready (button live), in progress (button blocked), done and conflict (inline messages) — no dialog, no toast', () => {
    const render = (state: Parameters<typeof ForkWritingStyleControl>[0]['state']) =>
      renderToStaticMarkup(createElement(ForkWritingStyleControl, { state, onFork: () => {} }));
    const ready = render({ kind: 'ready' });
    expect(ready).toContain('>Fork writing style locally</button>');
    expect(ready).not.toContain('disabled');
    expect(render({ kind: 'pending' })).toMatch(/<button[^>]*disabled=""/);
    expect(render({ kind: 'done' })).toContain(
      "Copied to the project&#x27;s skills. The local copy now takes precedence over the plugin.",
    );
    expect(FORK_DONE_MESSAGE).toBe("Copied to the project's skills. The local copy now takes precedence over the plugin.");
    expect(forkFailureMessage(new ApiError('SKILL_ALREADY_EXISTS', 'taken', 409))).toBe(FORK_CONFLICT_MESSAGE);
    expect(FORK_CONFLICT_MESSAGE).toBe('A skill with this name already exists in this project.');
    expect(render({ kind: 'failed', message: FORK_CONFLICT_MESSAGE })).toContain(FORK_CONFLICT_MESSAGE);
  });
});
