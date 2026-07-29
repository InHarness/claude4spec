/**
 * COPIED VERBATIM from the host's `shared/slug.ts`.
 *
 * Slug normalization is part of entity identity, so it moves with the types.
 * Byte-identical on purpose: an entity created before this release and one
 * created after must land on the same slug, or a release diff would report a
 * rename that never happened.
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

/** Tags use the same normalization. Copied alongside `slugify` for the same reason. */
export function tagSlug(name: string): string {
  return slugify(name);
}
