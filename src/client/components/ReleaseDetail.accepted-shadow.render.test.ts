// @vitest-environment happy-dom
/**
 * 2.1.49 (M17 ui-view `release-detail`) — the header of a release that accepted
 * a shadow carries, under the description, the line "Accepted shadow {id} @
 * {sha7}" (from the release's accepted shadow, `sha7` = the first seven
 * characters of `tipSha`), in the same format as the card on the release list.
 * With no accepted shadow there is no line. The rest of the header (name,
 * author and date, description, the capture counter) stays as it was.
 *
 * The data hooks are stubbed; the page itself is real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReleaseDetail as ReleaseDetailData } from '../../shared/entities.js';

const state = vi.hoisted(() => ({
  release: null as unknown,
  list: [] as unknown[],
}));

vi.mock('@tanstack/react-router', async () => {
  const React = await import('react');
  return {
    Link: ({ children }: { children?: unknown }) => React.createElement('a', null, children as never),
    useNavigate: () => async () => {},
  };
});
vi.mock('../hooks/useReleases.js', () => ({
  useRelease: () => ({ data: state.release, isLoading: false }),
  useReleaseList: () => ({ data: state.list }),
  useReleaseDiff: () => ({ data: undefined }),
  useReleaseSnapshot: () => ({ data: undefined }),
  useRestoreSpec: () => ({ mutateAsync: async () => {} }),
  useUnreleasedCount: () => ({ data: 0 }),
  forgetReleaseName: () => {},
  useUpdateRelease: () => ({ isPending: false, mutateAsync: async () => state.release }),
}));
vi.mock('../hooks/useReleasePushes.js', () => ({
  useReleasePushes: () => ({ data: [] }),
  useAllReleasePushes: () => ({ data: [] }),
  usePushRelease: () => ({ isPending: false, mutateAsync: async () => ({}) }),
}));
vi.mock('../hooks/useConfig.js', () => ({
  useConfig: () => ({ data: { name: 'p', remoteProjectId: null } }),
}));
vi.mock('../hooks/useRemoteAccount.js', () => ({
  useRemoteAccount: () => ({ data: { connected: false } }),
}));
vi.mock('./release/DeltaSection.js', () => ({ DeltaSection: () => null }));
vi.mock('./release/ReleaseSelect.js', () => ({ ReleaseSelect: () => null }));
vi.mock('./release/ReleasePushesList.js', () => ({ ReleasePushesList: () => null }));
vi.mock('./CreateBriefDialog.js', () => ({ CreateBriefDialog: () => null }));

import { ReleaseDetail } from './ReleaseDetail.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TIP = '9f2c4e7a1b3d5f60718293a4b5c6d7e8f9012345';

const PLAIN: ReleaseDetailData = {
  id: 7,
  name: 'v2.1.48',
  description: 'Plain release',
  createdBy: 'user',
  createdAt: '2026-10-12T10:00:00.000Z',
  acceptedShadow: null,
  countBreakdown: { entities: { endpoint: 2 }, pages: 1, total: 3 },
};

const ACCEPTED: ReleaseDetailData = {
  ...PLAIN,
  id: 8,
  name: 'v2.1.49',
  description: 'Accepted from run 42',
  acceptedShadow: { id: 'run-42/spec', tipSha: TIP },
};

let host: HTMLDivElement;
let root: Root;

async function mount(release: ReleaseDetailData, list: ReleaseDetailData[]) {
  state.release = release;
  state.list = list;
  const qc = new QueryClient();
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client: qc }, createElement(ReleaseDetail, { name: release.name })));
  });
}

/** The header block: the container of the release name (`<h2>`, or the rename input on the newest release). */
function header(): HTMLElement {
  const name = host.querySelector<HTMLElement>('h2, input[title^="Click to rename"]');
  if (!name) throw new Error('release header not rendered');
  return name.parentElement as HTMLElement;
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('release detail header — the accepted shadow (M17 release-detail, 2.1.49)', () => {
  it('[entity:release-detail] the header of a release that accepted a shadow carries "Accepted shadow {id} @ {sha7}" under the description (an older, read-only release)', async () => {
    await mount(ACCEPTED, [{ ...ACCEPTED, id: 9, name: 'newer' }, ACCEPTED]);

    const lines = Array.from(host.querySelectorAll<HTMLElement>('[data-accepted-shadow]'));
    expect(lines).toHaveLength(1);
    expect(lines[0]!.textContent).toBe(`Accepted shadow run-42/spec @ ${TIP.slice(0, 7)}`);
    // Under the description: the description's block comes right before it in the header.
    const description = lines[0]!.previousElementSibling as HTMLElement;
    expect(description.textContent).toBe('Accepted from run 42');
    expect(header().contains(lines[0]!)).toBe(true);
  });

  it('[entity:release-detail] the header of the newest release (editable description) also carries the accepted-shadow line under the description textarea', async () => {
    await mount(ACCEPTED, [ACCEPTED]);

    const line = host.querySelector<HTMLElement>('[data-accepted-shadow]');
    expect(line?.textContent).toBe(`Accepted shadow run-42/spec @ ${TIP.slice(0, 7)}`);
    expect(line!.previousElementSibling?.tagName).toBe('TEXTAREA');
    expect(header().contains(line!)).toBe(true);
  });

  it('[entity:release-detail] a release that did not accept a shadow (accepted shadow null or absent) has no such line; the rest of the header — name, author and date, description, capture counter — is rendered', async () => {
    await mount(PLAIN, [ACCEPTED, PLAIN]);
    expect(host.querySelector('[data-accepted-shadow]')).toBeNull();
    expect(host.textContent).not.toContain('Accepted shadow');
    expect(host.textContent).toContain('v2.1.48');
    expect(host.textContent).toContain('by user');
    expect(host.textContent).toContain('Plain release');
    expect(host.textContent).toContain('3 total captures');

    const { acceptedShadow: _omit, ...legacy } = PLAIN;
    await mount(legacy, [ACCEPTED, legacy]);
    expect(host.querySelector('[data-accepted-shadow]')).toBeNull();
  });
});
