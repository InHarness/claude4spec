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
  HOOK_TRUST_CONFIRMED_MESSAGE,
  HOOK_TRUST_UNCONFIRMED_MESSAGE,
  SkillHookTrustControl,
  whenAttaching,
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

/**
 * 2.1.57 — M52 `ybbal0vf`: the #skills card asks this machine to confirm the
 * attachments the repository's config carries (ASSUMPTION:dev-0002 — one
 * confirmation for the whole list, outside the card's shared save).
 */
describe('#skills — Skill projects from this repository (M52 ybbal0vf, 2.1.57)', () => {
  it('[section:ybbal0vf] the card warns that unconfirmed attachments are not used and offers one confirmation for the whole list; confirmed, it offers to revoke', () => {
    const render = (trusted: boolean, pending = false) =>
      renderToStaticMarkup(createElement(SkillHookTrustControl, { trusted, pending, onChange: () => {} }));
    const unconfirmed = render(false);
    expect(unconfirmed).toContain('data-trusted="false"');
    expect(unconfirmed).toContain(
      'The skill projects in this repository&#x27;s config are not confirmed on this machine, so none of them is used.',
    );
    expect(HOOK_TRUST_UNCONFIRMED_MESSAGE).toContain('not confirmed on this machine');
    expect(unconfirmed).toContain('>Confirm skill projects</button>');
    expect(unconfirmed).not.toContain('disabled');

    const confirmed = render(true);
    expect(confirmed).toContain('data-trusted="true"');
    expect(confirmed).toContain(HOOK_TRUST_CONFIRMED_MESSAGE.replace("'", '&#x27;'));
    expect(confirmed).toContain('>Revoke confirmation</button>');
    // Blocked while the decision is being stored.
    expect(render(false, true)).toMatch(/<button[^>]*disabled=""/);

    // The button flips the current decision.
    const seen: boolean[] = [];
    const tree = SkillHookTrustControl({ trusted: false, pending: false, onChange: (v) => seen.push(v) });
    const button = (tree.props.children as Array<{ props: { children: { props: { onClick: () => void } } } }>)[1]!.props.children;
    button.props.onClick();
    expect(seen).toEqual([true]);
  });

  it('[section:ybbal0vf] the element sits on the #skills card before the list, shown only while the draft attaches a skill project, and never joins the card\'s save', () => {
    const [card] = assembleSettings([SPEC_SKILLS_SETTINGS]);
    const el = card!.elements.find((e) => e.id === 'skill-hook-trust')!;
    expect(el).toMatchObject({ kind: 'custom', weight: 65, label: 'Skill projects from this repository' });
    expect(el.configKey).toBeUndefined();
    expect(el.keys).toBeUndefined();
    expect(el.visible).toBe(whenAttaching);
    const config = {} as ConfigResponse;
    expect(whenAttaching({ config, draft: draftOver({ 'skill.uses': ['billing-rules'] }) })).toBe(true);
    expect(whenAttaching({ config, draft: draftOver({ 'skill.uses': [] }) })).toBe(false);
    expect(whenAttaching({ config, draft: draftOver({}) })).toBe(false);
  });
});
