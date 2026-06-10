import type { RawSection } from '../../domain/raw-entity-reader.js';
import type { EntitySerializer } from '../types.js';

const serializer: EntitySerializer<RawSection> = {
  type: 'section',
  version: '1.0.0',

  singleElement: (section) => ({
    type: 'section',
    anchor: section.anchor,
    pagePath: section.pagePath,
    headingPath: section.headingPath,
    headingText: section.headingText,
    headingLevel: section.headingLevel,
    href: `/${section.pagePath}#${section.anchor}`,
    lineStart: section.lineStart,
    lineEnd: section.lineEnd,
  }),

  inlineMention: (section) => ({
    type: 'section',
    anchor: section.anchor,
    label: section.headingText,
    href: `/${section.pagePath}#${section.anchor}`,
  }),
};

/**
 * M31: exported instead of attached to a singleton — every SerializationEngine
 * instance (per ProjectContext, per CLI process) receives it via constructor.
 */
export const sectionSerializer = serializer as EntitySerializer<unknown>;
