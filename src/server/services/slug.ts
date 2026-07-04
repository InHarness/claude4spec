// `slugify`/`tagSlug` moved to src/shared/slug.ts (single source of truth —
// the client's createTagIdempotent needs the SAME normalization to recognize
// a name that already resolves to an existing tag). Re-exported here so the
// many existing server-side importers of this module don't need to change.
export { slugify, tagSlug } from '../../shared/slug.js';
import { slugify } from '../../shared/slug.js';

export function endpointSlug(method: string, path: string): string {
  const base = `${method.toLowerCase()}-${slugify(path)}`;
  return base.replace(/^-+|-+$/g, '');
}

export function dtoSlug(name: string): string {
  const withBoundaries = name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2');
  return slugify(withBoundaries);
}

export function databaseTableSlug(name: string): string {
  const withBoundaries = name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2');
  return slugify(withBoundaries);
}

export function uiViewSlug(name: string): string {
  const withBoundaries = name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2');
  return slugify(withBoundaries);
}

export function designSystemSlug(name: string): string {
  const withBoundaries = name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2');
  return slugify(withBoundaries);
}

export function acSlug(text: string): string {
  // AC text is sentence-shaped, not PascalCase — slugify pierwsze ~40 znaków.
  // Prefix 'ac-' dla czytelnosci w sciezkach i URL'ach.
  const trimmed = text.trim().slice(0, 40);
  const base = slugify(trimmed);
  if (!base) return '';
  return base.startsWith('ac-') ? base : `ac-${base}`;
}
