import { describe, expect, expectTypeOf, it } from 'vitest';
import type { TagListItem as HostTagListItem } from '../../shared/entities.js';
import type { TagListItem } from '../../plugin-types/plugin-runtime.js';
import type { Tag, TagPickerProps } from '../../plugin-types/ui.js';
import type { TagPickerProps as HostTagPickerProps } from '../host-ui-kit/detail/TagPicker.js';
import type { Tag as HostKitTag } from '../../shared/plugin-host/ui-kit-surface.js';
import type { tagsService } from './tags-service.js';

/**
 * DTO `tag-list-item` (M18), type-level half — compiled by `npm run typecheck`
 * (tsconfig.client.json takes `src/client/**`, tests included), so a field that
 * drifts from the DTO, or an item that stops reaching the kit as it is, fails
 * the build. The live payload half is `src/server/routes/tags.route.test.ts`.
 */

/** Mutual assignability + the same key set. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? ([keyof A] extends [keyof B] ? ([keyof B] extends [keyof A] ? true : false) : false) : false) : false;

/** The DTO's `fields`, as written (unchanged in 2.1.28); `color`/`description` always present, possibly `null`. */
interface TagListItemDto {
  slug: string;
  name: string;
  color: string | null;
  description: string | null;
  counts: Record<string, number>;
}

describe('tag-list-item — the type a plugin gets from useTags()', () => {
  it('[entity:tag-list-item] the published TagListItem has exactly the DTO fields, and items reach the /ui Tag and the TagPicker allTags item without a cast', () => {
    const published: Same<TagListItem, TagListItemDto> = true;
    expect(published).toBe(true);
    // The host's own item (what `tagsService.list()` resolves to) carries the
    // DTO fields with the same types, plus row timestamps.
    expectTypeOf<HostTagListItem>().toMatchTypeOf<TagListItemDto>();
    expectTypeOf<Awaited<ReturnType<typeof tagsService.list>>[number]>().toMatchTypeOf<TagListItemDto>();

    // `/ui` Tag (record `tag-filter-bar`) — one type, host and published.
    expectTypeOf<TagListItem>().toMatchTypeOf<Tag>();
    expectTypeOf<HostTagListItem>().toMatchTypeOf<HostKitTag>();
    // TagPicker `allTags` item — the public `Tag` since 2.1.42.
    expectTypeOf<TagPickerProps['allTags']>().toEqualTypeOf<Tag[]>();
    expectTypeOf<HostTagPickerProps['allTags']>().toEqualTypeOf<HostKitTag[]>();
    expectTypeOf<TagListItem>().toMatchTypeOf<TagPickerProps['allTags'][number]>();
    expectTypeOf<HostTagListItem>().toMatchTypeOf<HostTagPickerProps['allTags'][number]>();

    // Plain assignments, the way a plugin writes them.
    const items: TagListItem[] = [{ slug: 'billing', name: 'Billing', color: null, description: null, counts: { dto: 1 } }];
    const tags: Tag[] = items;
    const allTags: TagPickerProps['allTags'] = items;
    expect(tags[0]!.slug).toBe('billing');
    expect(allTags[0]!.name).toBe('Billing');
  });
});
