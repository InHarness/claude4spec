import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { serializeXmlTag } from '../../../../shared/xml-tags.js';

/**
 * 2.1.63 (M13 chipprops "Droga podpisu", M19 nh3zsgxf) — what the host-resolver
 * hands the type's `renderCard` slot for a `<single_element/>`:
 *  - `caption` only when the tag carries the attribute (absent → no prop);
 *  - `onCaptionChange` only where the tag can be written back (the editor's node
 *    view, `onAttrsChange`); calling it changes the tag's `caption` attribute on
 *    the page, never the entity.
 */

interface Dto {
  slug: string;
  title: string;
}

const ENTITY: Dto = Object.freeze({ slug: 'user', title: 'User' });
const ENTITY_BEFORE = structuredClone(ENTITY);

type CardCall = Record<string, unknown> & { slug: string };
const cardCalls: CardCall[] = [];

function RenderCard(props: CardCall) {
  // React dev may call a component once without props (component stack); keep real renders only.
  if (props && typeof props.slug === 'string') cardCalls.push(props);
  return createElement('div', { 'data-card': props?.slug }, props?.slug);
}

const def = {
  type: 'dto',
  label: 'DTO',
  labelPlural: 'DTOs',
  renderChip: RenderCard,
  renderCard: RenderCard,
  useGetBySlug: (slug: string | null) => ({ data: slug === 'user' ? ENTITY : null, isLoading: false }),
};

vi.mock('../../../entities/registry.js', () => ({
  getEntityDef: (type: string) => (type === 'dto' ? def : null),
}));
vi.mock('../../../core/plugin-host/useRegistryVersion.js', () => ({ useRegistryVersion: () => 0 }));
vi.mock('../../../core/plugin-host/host.js', () => ({
  categoriseBrokenChip: () => 'unknown-type',
  // No schema → the card's refLookup has nothing to resolve and fetches nothing.
  clientPluginHost: { getEntity: () => null, getAvailable: () => null, onRegistryChanged: () => () => {} },
}));
vi.mock('../../../entities/openEntity.js', () => ({ openEntityHandler: () => undefined }));
vi.mock('../../../runtime/plugin-boot-signal.js', () => ({
  frontendPluginsBooted: Promise.resolve(),
  pluginBootPending: () => false,
  settlePluginBoot: () => {},
}));

const { SingleElementRender } = await import('./SingleElement.js');

const fetchSpy = vi.fn();

function render(attrs: Record<string, string | null>, onAttrsChange?: (next: Record<string, string | null>) => void) {
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(SingleElementRender, { name: 'single_element', attrs, variant: 'block', onAttrsChange }),
    ),
  );
}

const lastCard = (): CardCall => {
  expect(cardCalls.length).toBeGreaterThan(0);
  return cardCalls.at(-1)!;
};

beforeEach(() => {
  cardCalls.length = 0;
  fetchSpy.mockReset();
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('single_element card — caption path (M13 chipprops)', () => {
  it('[ac:ac-zmiana-podpisu-przez-oncaptionchange] onCaptionChange of the card slot writes the caption attribute of the tag on the page, and the entity does not change', () => {
    const attrs = { type: 'dto', slug: 'user', caption: 'Old caption' };
    const writes: Array<Record<string, string | null>> = [];
    render(attrs, (next) => writes.push(next));

    const card = lastCard();
    expect(card.caption).toBe('Old caption');
    expect(typeof card.onCaptionChange).toBe('function');

    (card.onCaptionChange as (c: string | null) => void)('New caption');

    // (a) the tag's attribute changes — the same attribute set, only `caption` differs,
    // and the page serialises it back into the tag.
    expect(writes).toEqual([{ type: 'dto', slug: 'user', caption: 'New caption' }]);
    expect(serializeXmlTag('single_element', writes[0]!)).toBe(
      '<single_element type="dto" slug="user" caption="New caption"/>',
    );

    // (b) the entity does not change: the card got the resolved entity as is,
    // nothing mutated it, and no request (no entity write) left the browser.
    expect(card.entity).toBe(ENTITY);
    expect(ENTITY).toEqual(ENTITY_BEFORE);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('[ac:ac-zmiana-podpisu-przez-oncaptionchange] clearing the caption removes the attribute instead of writing caption=""', () => {
    const writes: Array<Record<string, string | null>> = [];
    render({ type: 'dto', slug: 'user', caption: 'Old caption' }, (next) => writes.push(next));
    const change = lastCard().onCaptionChange as (c: string | null) => void;

    change(null);
    change('');
    expect(writes).toEqual([
      { type: 'dto', slug: 'user', caption: null },
      { type: 'dto', slug: 'user', caption: null },
    ]);
    for (const w of writes) expect(serializeXmlTag('single_element', w)).toBe('<single_element type="dto" slug="user"/>');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('[ac:ac-karta-osadzona-znacznikiem-single-ele] a single_element card without a caption attribute gets no caption prop', () => {
    render({ type: 'dto', slug: 'user', caption: null }, () => {});
    const card = lastCard();
    expect('caption' in card).toBe(false);

    // The attribute missing from the set altogether is the same case.
    cardCalls.length = 0;
    render({ type: 'dto', slug: 'user' }, () => {});
    expect('caption' in lastCard()).toBe(false);

    // Not vacuous: with the attribute the prop is there.
    cardCalls.length = 0;
    render({ type: 'dto', slug: 'user', caption: 'Shown' }, () => {});
    expect(lastCard().caption).toBe('Shown');
  });

  it('a read-only reference (no onAttrsChange, as in chat) gets no onCaptionChange', () => {
    render({ type: 'dto', slug: 'user', caption: 'Read only' });
    const card = lastCard();
    expect('onCaptionChange' in card).toBe(false);
    expect(card.caption).toBe('Read only');
  });
});
