/**
 * 2.1.17 — M15 `ssh0om79`: both style selection surfaces badge every style with
 * the label of its `source`, read from the ONE shared map
 * (`WRITING_STYLE_SOURCE_BADGE`):
 *  - the `Writing style` select of the settings page (M15 L17 `m6ukdbsc`);
 *  - the onboarding style cards (M16 `os387tmx`), listing styles of every
 *    registry source of the selectable set.
 */
import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { WritingStyleSummary } from '../../../shared/writing-styles.js';

const AVAILABLE: WritingStyleSummary[] = vi.hoisted((): WritingStyleSummary[] => [
  { slug: 'team-voice', title: 'Team Voice', description: 'Ours.', version: 1, language: 'en', source: 'user' },
  { slug: 'layered-vertical-slices', title: 'Layered Vertical Slices', description: 'From a plugin.', version: 1, language: 'en', source: 'plugin' },
  { slug: 'project-voice', title: 'Project Voice', description: 'This project.', version: 1, language: 'en', source: 'project-rooted' },
  { slug: 'house-rules', title: 'House Rules', description: 'Attached.', version: 1, language: 'en', source: 'project-exposed' },
]);

const EXPECTED_BADGE: Record<string, string> = {
  'team-voice': 'yours',
  'layered-vertical-slices': 'plugin',
  'project-voice': 'project skill',
  'house-rules': 'attached project',
};

vi.mock('../../hooks/useWritingStyles.js', () => ({
  useWritingStyles: () => ({ data: { active: null, available: AVAILABLE } }),
}));

import { WRITING_STYLE_SETTINGS } from './writingStyleSettings.js';
import { WritingStyleList } from '../onboarding/WritingStyleList.js';

describe('writing style source badge on both selection surfaces (M15 ssh0om79, 2.1.17)', () => {
  it('[section:m6ukdbsc] the settings `Writing style` select offers every available style, each option carrying its source badge from the M15 map', () => {
    const element = WRITING_STYLE_SETTINGS.elements!.find((e) => e.id === 'writing-style')!;
    expect(element.kind).toBe('select');
    expect(element.label).toBe('Writing style');
    const options = element.useOptions!()!;
    expect(options.map((o) => o.value)).toEqual(AVAILABLE.map((s) => s.slug));
    for (const s of AVAILABLE) {
      const option = options.find((o) => o.value === s.slug)!;
      expect(option.label, s.slug).toBe(`${s.title} — ${EXPECTED_BADGE[s.slug]}`);
    }
    // `None` stays the null option, saved as null.
    expect(element.nullOption).toBeTruthy();
  });

  it('[section:os387tmx] the onboarding cards list the styles of every registry source and each card carries its source badge from the same M15 map', () => {
    const html = renderToStaticMarkup(
      createElement(WritingStyleList, { available: AVAILABLE, selection: undefined, onSelect: () => {} }),
    );
    // One card (radio) per style of every source, plus the `None` card.
    const radios = [...html.matchAll(/name="writing-style" value="([^"]+)"/g)].map((m) => m[1]);
    expect(radios).toEqual([...AVAILABLE.map((s) => s.slug), '__none__']);
    // Each style card carries its own source badge, next to its title.
    const cards = html.split('<label').slice(1);
    for (const [i, s] of AVAILABLE.entries()) {
      const card = cards[i]!;
      expect(card, s.slug).toContain(`>${s.title}</span>`);
      expect(card, s.slug).toContain(`>${EXPECTED_BADGE[s.slug]}</span>`);
      for (const [slug, other] of Object.entries(EXPECTED_BADGE)) {
        if (slug !== s.slug) expect(card, `${s.slug} not ${other}`).not.toContain(`>${other}</span>`);
      }
    }
    // The `None` card carries no badge.
    for (const label of Object.values(EXPECTED_BADGE)) expect(cards[AVAILABLE.length]).not.toContain(`>${label}</span>`);
  });
});
