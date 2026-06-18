/**
 * The 6 core XML tag kinds (5 reference type registry types M19 + `todo` M08).
 *
 * Extracted into a dependency-free leaf module so it can be imported by both
 * `xml-tags.ts` (which depends on `code-ranges.ts`) and `jsx-passthrough.ts`
 * (which `code-ranges.ts` depends on) without forming an import cycle.
 */
export const XML_TAG_KINDS = [
  'inline_mention',
  'single_element',
  'element_list',
  'tagged_list',
  'tagged_list_mixed',
  'todo',
] as const;

export type XmlTagKind = (typeof XML_TAG_KINDS)[number];
