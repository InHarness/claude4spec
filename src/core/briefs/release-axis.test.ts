import { describe, it, expect } from 'vitest';
import { compareBriefsByReleaseAxis, compareNumericSegments, type ReleaseAxisItem } from './release-axis.js';

// Created in the order v0.8 → v0.9 → v0.10, so v0.10 is the newest (highest rank).
const ranks = new Map([
  ['v0.8', 0],
  ['v0.9', 1],
  ['v0.10', 2],
]);

const at = '2026-01-01T00:00:00.000Z';
function brief(path: string, from: string | null, to: string | null, generatedAt = at): ReleaseAxisItem {
  return { path, fromRelease: from, toRelease: to, generatedAt };
}
function order(items: ReleaseAxisItem[], rankByName: ReadonlyMap<string, number> = ranks): string[] {
  return items
    .slice()
    .sort((a, b) => compareBriefsByReleaseAxis(a, b, rankByName))
    .map((i) => i.path);
}

describe('compareNumericSegments', () => {
  it('compares digit runs as numbers', () => {
    expect(compareNumericSegments('v0.10', 'v0.9')).toBeGreaterThan(0);
    expect(compareNumericSegments('0-2-108', '0-2-71')).toBeGreaterThan(0);
    expect(compareNumericSegments('0-2-71', '0-2-12')).toBeGreaterThan(0);
    expect(compareNumericSegments('0-2-12', '0-2-12')).toBe(0);
  });

  it('compares the rest as strings, a shorter prefix first', () => {
    expect(compareNumericSegments('a', 'b')).toBeLessThan(0);
    expect(compareNumericSegments('v1', 'v1.1')).toBeLessThan(0);
  });
});

describe('compareBriefsByReleaseAxis', () => {
  it('orders the brief\'s example table', () => {
    const items = [
      brief('h.md', null, null),
      brief('f.md', '0-2-108', '0-2-109'),
      brief('e.md', null, 'v0.8'),
      brief('c.md', 'v0.9', null),
      brief('g.md', '0-2-71', '0-2-72'),
      brief('a.md', 'v0.10', null),
      brief('d.md', 'v0.8', 'v0.9'),
      brief('b.md', 'v0.9', 'v0.10'),
    ];
    expect(order(items)).toEqual(['a.md', 'b.md', 'c.md', 'd.md', 'e.md', 'f.md', 'g.md', 'h.md']);
  });

  it('[ac:ac-briefy-wyzsza-ranga-to-release-wyzej] a higher-ranked to_release stands above a lower one, whatever the names say', () => {
    expect(order([brief('nine.md', 'v0.8', 'v0.9'), brief('ten.md', 'v0.9', 'v0.10')])).toEqual([
      'ten.md',
      'nine.md',
    ]);
  });

  it('[ac:ac-brief-od-najnowszego-do-teraz-pierwszy] a brief open from the newest release is first', () => {
    expect(order([brief('closed.md', 'v0.9', 'v0.10'), brief('open.md', 'v0.10', null)])[0]).toBe('open.md');
  });

  it('[ac:ac-brief-do-teraz-tuz-nad-briefami-from] [ac:ac-brief-do-teraz-pod-wyzsza-ranga] a brief open from X sits directly above the briefs ending at X and below every higher rank', () => {
    const got = order([
      brief('to-9-a.md', 'v0.8', 'v0.9'),
      brief('to-9-b.md', 'v0.8', 'v0.9', '2026-05-01T00:00:00.000Z'),
      brief('open-9.md', 'v0.9', null),
      brief('to-10.md', 'v0.9', 'v0.10'),
    ]);
    expect(got).toEqual(['to-10.md', 'open-9.md', 'to-9-b.md', 'to-9-a.md']);
  });

  it('[ac:ac-brief-release-nieznany-w-ogonie] [ac:ac-ogon-po-nazwie-release-numerycznie] puts unknown releases behind every known rank, by name descending in numeric segments', () => {
    const got = order([
      brief('x12.md', '0-2-11', '0-2-12'),
      brief('known.md', null, 'v0.8'),
      brief('x108.md', '0-2-107', '0-2-108'),
      brief('x71.md', '0-2-70', '0-2-71'),
      brief('open-unknown.md', '0-2-90', null),
    ]);
    expect(got).toEqual(['known.md', 'x108.md', 'open-unknown.md', 'x71.md', 'x12.md']);
  });

  it('[ac:ac-brief-oba-konce-null-w-ogonie] a brief with both ends null closes the tail', () => {
    const got = order([brief('none.md', null, null), brief('x.md', 'a', 'b'), brief('k.md', null, 'v0.8')]);
    expect(got).toEqual(['k.md', 'x.md', 'none.md']);
  });

  it('[ac:ac-remis-pozycji-generated-at-malejaco] breaks a tie on the axis by generated_at descending', () => {
    const got = order([
      brief('older.md', 'v0.8', 'v0.9', '2026-01-01T00:00:00.000Z'),
      brief('newer.md', 'v0.8', 'v0.9', '2026-02-01T00:00:00.000Z'),
    ]);
    expect(got).toEqual(['newer.md', 'older.md']);
  });

  it('[ac:ac-remis-generated-at-path-numerycznie] breaks an equal generated_at by path descending in numeric segments, not lexically', () => {
    const got = order([
      brief('0-2-12.md', 'v0.8', 'v0.9'),
      brief('0-2-108.md', 'v0.8', 'v0.9'),
      brief('0-2-71.md', 'v0.8', 'v0.9'),
    ]);
    expect(got).toEqual(['0-2-108.md', '0-2-71.md', '0-2-12.md']);
  });

  it('with no releases in the DB everything is tail, still a stable total order', () => {
    const got = order([brief('a.md', 'v0.9', 'v0.10'), brief('b.md', 'v0.8', 'v0.9')], new Map());
    expect(got).toEqual(['a.md', 'b.md']);
  });
});
