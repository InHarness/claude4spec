import type { RawEntity, RawSection } from '../domain/raw-entity-reader.js';
import type { ViewKind } from './types.js';

export function fallbackEntity(entity: RawEntity, view: ViewKind): Record<string, unknown> {
  return {
    type: entity.type,
    slug: entity.slug,
    tags: entity.tags,
    ...entity.data,
    _fallback: true,
    _type: entity.type,
    _view: view,
  };
}

export function fallbackSection(section: RawSection, view: ViewKind): Record<string, unknown> {
  return {
    type: 'section',
    anchor: section.anchor,
    pagePath: section.pagePath,
    headingPath: section.headingPath,
    headingText: section.headingText,
    headingLevel: section.headingLevel,
    lineStart: section.lineStart,
    lineEnd: section.lineEnd,
    _fallback: true,
    _type: 'section',
    _view: view,
  };
}
