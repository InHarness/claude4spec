/**
 * 2.1.40 (M18) — the public `Tag` type, exported from the ROOT of
 * `@c4s/plugin-runtime`. Its shape belongs to the tags module, not to a kit
 * component: `TagFilterBar.tags`, `EntityListRow.tagLookup` and the `tagLookup`
 * the host hands a `renderRow` slot all take it.
 *
 * A minimal STRUCTURAL shape with no counts: a `TagListItem` from `useTags()`
 * (`Tag` + `counts`) or the host's own record (`counts`, timestamps) is
 * assignable to it as is, with no adapter and no cast. Picking tags by count
 * (e.g. "the most used ones for the filter bar") is the consumer's job, on the
 * `useTags` items, before it hands them to a component.
 */
export interface Tag {
  slug: string;
  name: string;
  color?: string | null;
  description?: string | null;
}
