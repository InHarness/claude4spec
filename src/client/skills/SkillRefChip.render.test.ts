/**
 * 2.1.9 — M52 `<skill_ref slug/>` (sheet `znaczniki-xml-m52`): the tag's
 * registration, its assigned render `SkillRefChip` and that render in chat —
 * a user message and an assistant reply alike (M05 `rehyxchp` step 0).
 *
 * Static render (`renderToStaticMarkup`); the `chat` skill listing is seeded
 * into the query cache under the key the chip reads.
 */
import { describe, expect, it, vi } from 'vitest';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { UIContentBlock } from '@inharness-ai/agent-chat';

vi.mock('@inharness-ai/agent-chat', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@inharness-ai/agent-chat')>()),
  useMessageReducer: () => ({ state: { messages: [] }, handleWireEvent: () => {}, restoreMessages: () => {}, clear: () => {} }),
  useEventStream: () => ({ joinStream: async () => false, disconnect: () => {} }),
}));

import '../xml-markup/host-renders.js';
import { getXmlTag } from '../../shared/xml-markup/registry.js';
import { parseXmlTags, serializeXmlTag } from '../../shared/xml-tags.js';
import { getTagRender } from '../xml-markup/renders.js';
import { SkillRefRender } from '../xml-markup/tags/skills.js';
import { chipTargetOf, isChipTag } from '../chat/xml-chip-preprocess.js';
import { ChatMarkdown } from '../chat/ChatMarkdown.js';
import { BlockRenderer } from '../chat/BlockRenderer.js';
import { chatSkillListingKey } from './chatSkillListing.js';
import type { SkillListing } from '../lib/skills-api.js';

const LISTING: SkillListing = {
  listing: [{ slug: 'review-checklist', description: 'Review a page', origin: 'project-rooted' }],
  writingStyle: null,
};

function withListing(node: ReactElement, listing: SkillListing | null = LISTING): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (listing) qc.setQueryData(chatSkillListingKey, listing);
  return renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, node));
}

/** The chip's outer span (icon + label), as rendered. */
function chipOf(html: string, slug: string): string | null {
  const re = new RegExp(`<span[^>]*data-skill-ref="${slug}"[^>]*>[\\s\\S]*?</span></span>`);
  return html.match(re)?.[0] ?? null;
}

describe('M52 XML markup sheet — znaczniki-xml-m52', () => {
  it('[entity:znaczniki-xml-m52#skill_ref] `skill_ref` is registered inline with the single attribute `slug`, rendered by SkillRefChip, broken when the slug is outside the chat listing', () => {
    const def = getXmlTag('skill_ref');
    expect(def).toEqual({ name: 'skill_ref', attrOrder: ['slug'], form: 'inline' });
    // Project-state validation is the chip's, never a registry `validate`.
    expect(def?.validate).toBeUndefined();
    // Generic parser + serializer carry it.
    expect(serializeXmlTag('skill_ref', { slug: 'review-checklist' })).toBe('<skill_ref slug="review-checklist"/>');
    expect(parseXmlTags('use <skill_ref slug="review-checklist"/> now').map((t) => [t.kind, t.attrs])).toEqual([
      ['skill_ref', { slug: 'review-checklist' }],
    ]);
    // The render its owner assigned.
    expect(getTagRender('skill_ref')).toBe(SkillRefRender);

    const live = withListing(createElement(SkillRefRender, { name: 'skill_ref', attrs: { slug: 'review-checklist' }, variant: 'inline' }));
    expect(live).toContain('data-skill-ref-state="normal"');
    expect(live).toContain('/review-checklist');

    const gone = withListing(createElement(SkillRefRender, { name: 'skill_ref', attrs: { slug: 'vanished' }, variant: 'inline' }));
    expect(gone).toContain('data-skill-ref-state="broken"');
    expect(gone).toContain('[missing skill: vanished]');

    // Listing not read yet: neither live nor broken.
    const pending = withListing(
      createElement(SkillRefRender, { name: 'skill_ref', attrs: { slug: 'vanished' }, variant: 'inline' }),
      null,
    );
    expect(pending).toContain('data-skill-ref-state="loading"');
  });
});

describe('M52 edge cases', () => {
  it('[ac:m52-edge-missing-skill-chip-broken] a chip pointing at a skill that does not exist renders broken — in chat history and in the composer’s render', () => {
    const html = withListing(createElement(ChatMarkdown, { text: 'try <skill_ref slug="vanished"/>' }));
    const chip = chipOf(html, 'vanished');
    expect(chip).not.toBeNull();
    expect(chip).toContain('data-skill-ref-state="broken"');
    expect(chip).toContain('[missing skill: vanished]');
    // The composer's node view shows the same assigned render.
    const composer = withListing(createElement(getTagRender('skill_ref')!, { name: 'skill_ref', attrs: { slug: 'vanished' }, variant: 'inline' }));
    expect(composer).toContain('data-skill-ref-state="broken"');
  });
});

describe('M05 chat chips for a tag with an assigned render', () => {
  it('[ac:m05-chip-slug-bez-type-przypisany-render] a tag with `slug` and no `type` whose owner assigned a render shows in chat as that component, not as a broken chip', () => {
    expect(chipTargetOf(getXmlTag('skill_ref')!)).toBeNull();
    expect(isChipTag('skill_ref')).toBe(true);
    const html = withListing(createElement(ChatMarkdown, { text: 'apply <skill_ref slug="review-checklist"/> please' }));
    const chip = chipOf(html, 'review-checklist');
    expect(chip).toContain('data-skill-ref-state="normal"');
    expect(html).not.toContain('[broken:');
    expect(html).not.toContain('data-broken-category');
    expect(html).not.toContain('&lt;skill_ref');
  });

  it('[ac:m05-chip-w-wiadomosci-uzytkownika] the tag sent in a user message shows in chat history with the same chip as in an assistant reply', () => {
    const text = 'apply <skill_ref slug="review-checklist"/> please';
    const block = { type: 'text', text, isStreaming: false } as unknown as UIContentBlock;
    const render = (side: 'user' | 'assistant') =>
      withListing(createElement(BlockRenderer, { block, siblings: [block], side, model: 'opus' }));
    const user = chipOf(render('user'), 'review-checklist');
    const assistant = chipOf(render('assistant'), 'review-checklist');
    expect(user).not.toBeNull();
    expect(user).toContain('data-skill-ref-state="normal"');
    expect(user).toBe(assistant);
  });
});
