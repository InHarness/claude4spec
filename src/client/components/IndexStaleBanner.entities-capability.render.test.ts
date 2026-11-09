// @vitest-environment happy-dom
/**
 * 2.1.77 (M26 L19 `e6k3f793`, slot `Pas awarii` of `m26ui01`) — the index
 * status card and the failure strip in a project without the capability
 * `entities`. Both read the same aggregate (`GET /_meta/index-status`); the rows
 * fed here are the server registry's own snapshot for that project, so the test
 * pins the whole path from the capability to what the user sees.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => () => {},
}));

import { IndexStaleBanner, FAILURE_STRIP_SENTENCE, FAILURE_STRIP_SENTENCE_NO_ENTITIES } from './IndexStaleBanner.js';
import { IndexStatusElement } from './settings/cards/IndexStatusElement.js';
import { PROJECTION_IDS, ProjectionStatusRegistry } from '../../server/services/projection-status.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })));
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

/** The registry of a project with/without `entities`, every projection globally stale. */
function projections(entities: boolean) {
  const status = new ProjectionStatusRegistry(undefined, { entities });
  for (const id of status.ids()) status.markStale(id);
  return status.snapshot();
}

async function render(el: ReactElement, opts: { entities: boolean }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(['index-status'], { projections: projections(opts.entities) });
  qc.setQueryData(['config'], { capabilities: opts.entities ? ['briefs', 'entities', 'multi-root'] : ['skill-exposure'] });
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client: qc }, el));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe('index status and failure strip without the capability `entities` (2.1.77)', () => {
  it('[ac:ac-karta-index-status-w-projekcie-bez-mo] the "Index status" card in a project without `entities` has no row of the entity projection', async () => {
    await render(createElement(IndexStatusElement), { entities: false });
    expect(host.querySelector(`[data-testid="index-status-row-${PROJECTION_IDS.entities}"]`)).toBeNull();
    expect(host.textContent).not.toContain('Entity tables');
    // The card is there with the rows a project without entities has.
    expect(host.querySelector(`[data-testid="index-status-row-${PROJECTION_IDS.sections}"]`)).not.toBeNull();
    expect(host.querySelector(`[data-testid="index-status-row-${PROJECTION_IDS.pageLinks}"]`)).not.toBeNull();

    // With the capability the entity row is on the card.
    act(() => root.unmount());
    root = createRoot(host);
    await render(createElement(IndexStatusElement), { entities: true });
    expect(host.querySelector(`[data-testid="index-status-row-${PROJECTION_IDS.entities}"]`)).not.toBeNull();
  });

  it('[ac:ac-pas-awarii-w-projekcie-bez-mozliwosci] the failure strip in a project without `entities` does not mention entity lists', async () => {
    await render(createElement(IndexStaleBanner), { entities: false });
    const sentence = host.querySelector('[data-testid="index-stale-sentence"]')?.textContent ?? '';
    expect(host.querySelector('[data-testid="index-stale-banner"]')).not.toBeNull();
    expect(sentence).toBe(FAILURE_STRIP_SENTENCE_NO_ENTITIES);
    expect(sentence).toBe('Search is unavailable — the index needs to be rebuilt.');
    expect(host.textContent?.toLowerCase()).not.toContain('entity');

    // A project with `entities` gets the full sentence.
    act(() => root.unmount());
    root = createRoot(host);
    await render(createElement(IndexStaleBanner), { entities: true });
    expect(host.querySelector('[data-testid="index-stale-sentence"]')?.textContent).toBe(FAILURE_STRIP_SENTENCE);
  });
});
