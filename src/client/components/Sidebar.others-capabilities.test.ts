/**
 * 2.1.77 (M18 `rxlzqki1`) — the "Tags" item of OTHERS inherits M18's
 * requirement `entities`: a project without the capability has no Tags item;
 * the other items stay in their order.
 */
import { describe, expect, it } from 'vitest';
import { othersItemsFor } from './Sidebar.js';

const labels = (caps: readonly string[] | undefined) => othersItemsFor(caps).map((i) => i.label);

describe('OTHERS items by capability (2.1.77)', () => {
  it('without `entities` there is no "Tags" item', () => {
    expect(labels(['briefs'])).toEqual(['Plans', 'Releases', 'TODOs', 'Links', 'Briefs']);
  });

  it('with `entities` (or no capability list read yet) "Tags" stays in its place', () => {
    expect(labels(['entities', 'briefs'])).toEqual(['Plans', 'Releases', 'TODOs', 'Tags', 'Links', 'Briefs']);
    expect(labels(undefined)).toEqual(['Plans', 'Releases', 'TODOs', 'Tags', 'Links', 'Briefs']);
  });
});
