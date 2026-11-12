import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { EXPOSED_PROJECTS_QUERY_KEY } from '../../lib/spec-skills-api.js';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ExposedProjectRow } from '../../../shared/spec-skills.js';
import { assembleSettings } from '../settings/registry.js';
import {
  FORK_CONFLICT_MESSAGE,
  FORK_DONE_MESSAGE,
  ForkWritingStyleControl,
  addedUses,
  confirmAddedAfterSave,
  confirmationAfter,
  confirmationMarker,
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
  { name: 'billing-rules', description: 'How billing works.', projectId: 'billing', projectType: 'skill', uses: true, status: 'ok', confirmed: true },
  { name: 'docs', uses: false, status: 'ambiguous', confirmed: false },
  { name: 'ghost', uses: true, status: 'unavailable', confirmed: true },
];

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

  it('the card: anchor #skills in the Agent group (weight 20), no card note; the exposure elements require skill-exposure (no toggle, no scope); the tooltip of Skill name, the helper of Entry page', () => {
    const [card] = assembleSettings([SPEC_SKILLS_SETTINGS], 'project');
    expect(card!.decl).toMatchObject({ anchor: 'skills', title: 'Skills', group: 'Agent', weight: 20 });
    // 2.1.77 (M52 `1osy2o5r`): the card note became the Entry page helper.
    expect(card!.decl.description).toBeUndefined();
    const el = (id: string) => card!.elements.find((e) => e.id === id)!;
    expect(card!.elements.map((e) => e.id)).toEqual([
      'skill-name',
      'skill-description',
      'skill-entry',
      'skill-context-types',
      'used-skill-projects',
      'fork-writing-style',
    ]);
    expect(el('used-skill-projects').keys).toEqual([['skill', 'uses']]);
    expect(el('skill-name').tooltip).toBe('The address other projects in this workspace use to attach this project as a skill.');
    expect(el('skill-entry').help).toBe('Projects that use this one read it live and read-only.');
    expect(el('skill-entry').effectMessage).toBe('Applies to the next read.');
    expect(el('used-skill-projects').effectMessage).toBe('Applies from the next new conversation.');
    // No visibility condition any more: the capability decides.
    for (const id of ['skill-name', 'skill-description', 'skill-entry', 'skill-context-types']) {
      expect(el(id).requires, id).toEqual(['skill-exposure']);
      expect(el(id).visible, id).toBeUndefined();
    }
    expect(el('used-skill-projects').requires).toBeUndefined();
    expect(el('fork-writing-style').requires).toBeUndefined();
    // A project without the capability keeps only the two elements of every type.
    const [spec] = assembleSettings([SPEC_SKILLS_SETTINGS], 'project', new Set(['briefs', 'entities', 'multi-root']));
    expect(spec!.elements.map((e) => e.id)).toEqual(['used-skill-projects', 'fork-writing-style']);
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
    const [card] = assembleSettings([SPEC_SKILLS_SETTINGS], 'project');
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
 * 2.1.67 — M52 `qtq9iusb` / `uluzymnm`: a name is confirmed, not the list. An
 * attached row without a confirmation on this machine carries `Unconfirmed` and
 * a "Confirm" action; a row ticked on the card is confirmed with the save. What
 * the running card shows is covered end-to-end (tests/e2e/spec-skills.test.ts);
 * these cases pin the helpers the card is built from.
 */
describe('#skills — attachment confirmation helpers (M52 qtq9iusb, 2.1.67)', () => {
  const MIXED: ExposedProjectRow[] = [
    { name: 'billing-rules', projectId: 'billing', uses: true, status: 'ok', confirmed: true },
    { name: 'legal-terms', projectId: 'legal', uses: true, status: 'ok', confirmed: false },
    { name: 'docs-style', projectId: 'docs', uses: false, status: 'ok', confirmed: false },
  ];

  it('[section:qtq9iusb] only an attached, unconfirmed row is marked Unconfirmed, with a Confirm action; the marker leaves the checkbox live', () => {
    expect(confirmationMarker({ uses: true, confirmed: false })).toBe('Unconfirmed');
    expect(confirmationMarker({ uses: true, confirmed: true })).toBeNull();
    expect(confirmationMarker({ uses: false, confirmed: false })).toBeNull();
    const html = renderToStaticMarkup(
      createElement(UsedSkillProjectsList, {
        rows: MIXED,
        uses: ['billing-rules', 'legal-terms'],
        onToggle: () => {},
        onConfirm: () => {},
      }),
    );
    expect(html).toMatch(/data-skill-name="legal-terms"[\s\S]*?data-marker="Unconfirmed"[^>]*>Unconfirmed</);
    expect(html).toContain('data-confirm-skill-use="legal-terms"');
    expect(html.match(/data-marker="Unconfirmed"/g)).toHaveLength(1);
    expect(html).not.toContain('data-confirm-skill-use="billing-rules"');
    expect(html).not.toContain('data-confirm-skill-use="docs-style"');
  });

  it('[section:qtq9iusb] a confirmation write carries the confirmed names over and adds the new ones once; the added names are the draft\'s names not attached yet', () => {
    expect(confirmationAfter(MIXED, ['legal-terms'])).toEqual(['billing-rules', 'legal-terms']);
    expect(confirmationAfter(MIXED, ['billing-rules'])).toEqual(['billing-rules']);
    expect(addedUses(MIXED, ['billing-rules', 'legal-terms', 'docs-style'])).toEqual(['docs-style']);
    expect(addedUses(MIXED, ['billing-rules'])).toEqual([]);
  });

  it('[section:qtq9iusb] while one confirmation is in flight every Confirm is disabled, so a second write cannot overwrite the first', () => {
    const TWO: ExposedProjectRow[] = [
      ...MIXED,
      { name: 'tax-rules', projectId: 'tax', uses: true, status: 'ok', confirmed: false },
    ];
    const render = (confirming: string | null) =>
      renderToStaticMarkup(
        createElement(UsedSkillProjectsList, {
          rows: TWO,
          uses: ['billing-rules', 'legal-terms', 'tax-rules'],
          onToggle: () => {},
          onConfirm: () => {},
          confirming,
        }),
      );
    const confirmButton = (html: string, name: string) =>
      html.match(new RegExp(`<button[^>]*data-confirm-skill-use="${name}"[^>]*>`))?.[0];
    // Idle: both Confirm actions are live.
    const idle = render(null);
    expect(confirmButton(idle, 'legal-terms')).toBeDefined();
    expect(confirmButton(idle, 'legal-terms')).not.toMatch(/\sdisabled/);
    expect(confirmButton(idle, 'tax-rules')).not.toMatch(/\sdisabled/);
    // legal-terms in flight: the OTHER row's Confirm is disabled too — its write,
    // built from the same rows, would replace the list without legal-terms.
    expect(confirmationAfter(TWO, ['tax-rules'])).not.toContain('legal-terms');
    const busy = render('legal-terms');
    expect(confirmButton(busy, 'legal-terms')).toMatch(/\sdisabled/);
    expect(confirmButton(busy, 'tax-rules')).toMatch(/\sdisabled/);
  });

  it('[ac:ac-zapis-potwierdzenia-z-karty-skills-za] a confirmation write from the #skills card keeps a confirmed name outside skill.uses — the Confirm action and the confirmation of an added row alike; unticking takes the attachment off, not the confirmation', () => {
    // Rows as the list answers them (2.1.69): `retired-skill` is confirmed here and not in
    // skill.uses — an unattached row; `docs-style` was unticked, its name stays confirmed.
    const ROWS_2169: ExposedProjectRow[] = [
      { name: 'billing-rules', projectId: 'billing', uses: true, status: 'ok', confirmed: true },
      { name: 'docs-style', projectId: 'docs', uses: false, status: 'ok', confirmed: true },
      { name: 'legal-terms', projectId: 'legal', uses: true, status: 'ok', confirmed: false },
      { name: 'retired-skill', uses: false, status: 'unavailable', confirmed: true },
      { name: 'tax-rules', projectId: 'tax', uses: false, status: 'ok', confirmed: false },
    ];
    // The Confirm action of `legal-terms`: every confirmed name of the list plus the new one.
    expect(confirmationAfter(ROWS_2169, ['legal-terms'])).toEqual(['billing-rules', 'docs-style', 'retired-skill', 'legal-terms']);

    // Ticking `tax-rules` and saving: `afterSave` confirms the added names with
    // `confirmationAfter(rows, added)` — the same confirmed names carried over.
    const added = addedUses(ROWS_2169, ['billing-rules', 'legal-terms', 'tax-rules']);
    expect(added).toEqual(['tax-rules']);
    expect(confirmationAfter(ROWS_2169, added)).toEqual(['billing-rules', 'docs-style', 'retired-skill', 'tax-rules']);
    // The unattached confirmed row is shown unticked, with no Unconfirmed marker and no Confirm.
    const html = renderToStaticMarkup(
      createElement(UsedSkillProjectsList, {
        rows: ROWS_2169,
        uses: ['billing-rules', 'legal-terms'],
        onToggle: () => {},
        onConfirm: () => {},
      }),
    );
    expect(html).toMatch(/data-skill-name="retired-skill"[\s\S]*?<input type="checkbox"(?![^>]*checked)/);
    expect(html).not.toContain('data-confirm-skill-use="retired-skill"');
    expect(html).not.toContain('data-confirm-skill-use="docs-style"');
  });

  it('[section:qtq9iusb] afterSave without an added row writes no confirmation and re-reads the list', async () => {
    const qc = new QueryClient();
    qc.setQueryData(EXPOSED_PROJECTS_QUERY_KEY, MIXED);
    const writes: string[][] = [];
    await confirmAddedAfterSave(qc, async (names) => {
      writes.push(names);
    });
    expect(writes).toEqual([]);
    expect(qc.getQueryState(EXPOSED_PROJECTS_QUERY_KEY)?.isInvalidated).toBe(true);
  });

  it('[section:qtq9iusb] the card element "Used skill projects" confirms through afterSave; the old whole-list confirmation element is gone', () => {
    const [card] = assembleSettings([SPEC_SKILLS_SETTINGS], 'project');
    expect(card!.elements.find((e) => e.id === 'skill-hook-trust')).toBeUndefined();
    const el = card!.elements.find((e) => e.id === 'used-skill-projects')!;
    expect(el.afterSave).toBeTypeOf('function');
  });
});
