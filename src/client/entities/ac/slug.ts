/**
 * Client-side slug generator — mirror of src/server/services/slug.ts:acSlug.
 * Used by FrontendModule.slugFrom for preview/UI; the server is the source of
 * truth for actual collisions.
 */
export function acSlugClient(text: string): string {
  const trimmed = text.trim().slice(0, 40);
  const base = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!base) return '';
  return base.startsWith('ac-') ? base : `ac-${base}`;
}
