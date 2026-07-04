/**
 * Slug normalization shared between server and client. `tagSlug`/`slugify`
 * specifically need a single source of truth on both sides: the client's
 * `createTagIdempotent` (src/client/runtime/tags-service.ts) must compute the
 * SAME slug the backend's `TagsService.create`/`tagSlug` would, to recognize
 * "this name already resolves to an existing tag" without re-implementing
 * (and risking drift from) the server's normalization rules.
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    // ł nie ma dekompozycji NFD — mapujemy jawnie przed normalizacją.
    .replace(/ł/g, 'l')
    // Transliteracja diakrytyków: NFD + usunięcie znaków łączących
    // (ó→o, ż→z, ź→z, ę→e, ą→a, ś→s, ć→c, ń→n).
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function tagSlug(name: string): string {
  return slugify(name);
}
