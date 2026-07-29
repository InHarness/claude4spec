/**
 * Identity of the two types this package contributes: the constants the host
 * reads off the manifest, and the slug rules that define what "the same entity"
 * means.
 *
 * `endpointSlug` / `dtoSlug` are copied verbatim from the host's
 * `services/slug.ts`. They cannot be shared: the slug rule IS the entity's
 * identity, so it belongs to whoever owns the type, and a release cut before
 * this move must resolve to the same slugs after it.
 */

import { slugify } from './slugify.js';

export const ENDPOINT_TYPE = 'endpoint';
export const ENDPOINT_TABLE = 'endpoint';
export const ENDPOINT_PATH_PREFIX = '/endpoints';
export const ENDPOINT_DISPLAY_ORDER = 10;

export const DTO_TYPE = 'dto';
export const DTO_TABLE = 'dto';
export const DTO_PATH_PREFIX = '/dtos';
export const DTO_DISPLAY_ORDER = 20;

/**
 * The junction coupling the two types. It is why they must ship in ONE
 * envelope: splitting them would push the join back onto the host, which is the
 * exact arrangement this release removes.
 */
export const ENDPOINT_DTO_TABLE = 'endpoint_dto';

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
