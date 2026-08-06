/**
 * How the embed reads a window, and the one detail that silently produces a grid
 * of `[object Object]`.
 *
 * `CollectionWindowResult.items` is dense row-major, which is why the v1
 * plugin's client-side `densify()` is gone. What is easy to carry over anyway is
 * the assumption that an element is a STRING. It is not: the window decodes the
 * item's payload fields and drops the coordinates, so each element is
 * `{ value: string | null }`. Nothing about that fails loudly — the grid renders,
 * with every cell reading `[object Object]`.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWindow } from '../../src/entity/spreadsheet/frontend/hooks.js';

const okJson = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

function stubFetch(impl: (url: string) => Response) {
  const spy = vi.fn((input: unknown) => Promise.resolve(impl(String(input))));
  vi.stubGlobal('fetch', spy);
  return spy;
}

afterEach(() => vi.unstubAllGlobals());

describe('fetchWindow', () => {
  it('unwraps `{ value }` into the string the grid renders', async () => {
    stubFetch(() => okJson({ items: [[{ value: 'a' }, { value: 'b' }], [{ value: 'c' }, { value: null }]] }));
    expect(await fetchWindow('sheet', 1, 1, 2, 2)).toEqual([
      ['a', 'b'],
      ['c', ''],
    ]);
  });

  it('reads an unwritten coordinate as empty, not as "null"', async () => {
    stubFetch(() => okJson({ items: [[{ value: null }]] }));
    expect(await fetchWindow('sheet', 1, 1, 1, 1)).toEqual([['']]);
  });

  it('asks with the AXIS-GENERIC coordinate names', async () => {
    /**
     * The route takes `a1/b1/a2/b2` — the first declared axis outer — not the
     * `r1/c1/r2/c2` v1's own routes used. Sending the old names yields
     * `Number(undefined)` = NaN on every bound, which the core rejects; the grid
     * would then render permanently empty with a 400 in the console.
     */
    const spy = stubFetch(() => okJson({ items: [] }));
    await fetchWindow('sheet', 2, 3, 4, 5);
    const url = String(spy.mock.calls[0]?.[0]);
    expect(url).toContain('a1=2');
    expect(url).toContain('b1=3');
    expect(url).toContain('a2=4');
    expect(url).toContain('b2=5');
  });

  it('reads through the cross-cutting entities router, not the type pathPrefix', async () => {
    const spy = stubFetch(() => okJson({ items: [] }));
    await fetchWindow('sheet', 1, 1, 1, 1);
    const url = String(spy.mock.calls[0]?.[0]);
    expect(url).toContain('/entities/spreadsheet/sheet/collections/cells/window');
  });

  it('escapes a slug rather than building a broken URL', async () => {
    const spy = stubFetch(() => okJson({ items: [] }));
    await fetchWindow('a/b', 1, 1, 1, 1);
    expect(String(spy.mock.calls[0]?.[0])).toContain('a%2Fb');
  });

  it('answers null on a failed read so the grid can hold its last good state', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 }) as unknown as Response));
    expect(await fetchWindow('missing', 1, 1, 1, 1)).toBeNull();
  });

  it('survives a row that is not an array', async () => {
    stubFetch(() => okJson({ items: [[{ value: 'a' }], 'nope'] }));
    expect(await fetchWindow('sheet', 1, 1, 2, 1)).toEqual([['a'], []]);
  });

  it('accepts a bare string element, in case the decode ever unwraps upstream', async () => {
    stubFetch(() => okJson({ items: [['a']] }));
    expect(await fetchWindow('sheet', 1, 1, 1, 1)).toEqual([['a']]);
  });
});
