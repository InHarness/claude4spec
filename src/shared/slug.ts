/**
 * Slug normalization shared between server and client. `tagSlug`/`slugify`
 * specifically need a single source of truth on both sides: the client's
 * `createTagIdempotent` (src/client/runtime/tags-service.ts) must compute the
 * SAME slug the backend's `TagsService.create`/`tagSlug` would, to recognize
 * "this name already resolves to an existing tag" without re-implementing
 * (and risking drift from) the server's normalization rules.
 */
export function slugify(input: string): string {
  const base = input
    .toLowerCase()
    // ł nie ma dekompozycji NFD — mapujemy jawnie przed normalizacją.
    .replace(/ł/g, 'l')
    // Transliteracja diakrytyków: NFD + usunięcie znaków łączących
    // (ó→o, ż→z, ź→z, ę→e, ą→a, ś→s, ć→c, ń→n).
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (base) return base;
  // Input outside the Latin-diacritic set this transliterates (CJK,
  // Cyrillic, Arabic, …) or pure punctuation collapses to '' above. Callers
  // that key a filename/URL segment off this value (e.g. ReleaseFileStore's
  // `<slug>.json`) would otherwise silently produce an empty path segment or
  // a leading-dot dotfile that then gets excluded by every directory listing
  // that skips dotfiles — falling back to a short, deterministic,
  // kebab-case-safe identifier derived from the input's codepoints keeps the
  // result always non-empty and non-dot-prefixed.
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return `x-${hash.toString(36)}`;
}

export function tagSlug(name: string): string {
  return slugify(name);
}
