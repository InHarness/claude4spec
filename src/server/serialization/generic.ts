import type { RawEntity, RawSection } from '../discovery/raw-entity-reader.js';
import type { ViewKind } from './types.js';

/**
 * The payload the host builds when a type does not compute a view itself.
 *
 * 0.2.9 renamed this from `fallback`: with schemas, snapshot and restore all
 * derived from `data.schema`, a type that computes nothing is fully served
 * rather than degraded. `_generic: true` says "the host shaped this row", which
 * is a fact about provenance — not, as `_fallback` implied, an apology.
 */
export function genericEntity(entity: RawEntity, view: ViewKind): Record<string, unknown> {
  return {
    type: entity.type,
    slug: entity.slug,
    tags: entity.tags,
    ...entity.data,
    _generic: true,
    _type: entity.type,
    _view: view,
  };
}

export function genericSection(section: RawSection, view: ViewKind): Record<string, unknown> {
  return {
    type: 'section',
    anchor: section.anchor,
    pagePath: section.pagePath,
    headingPath: section.headingPath,
    headingText: section.headingText,
    headingLevel: section.headingLevel,
    lineStart: section.lineStart,
    lineEnd: section.lineEnd,
    _generic: true,
    _type: 'section',
    _view: view,
  };
}
