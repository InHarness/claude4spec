import type { RawSection } from '../../domain/raw-entity-reader.js';
import { serializationEngine } from '../../core/plugin-host/serialization-engine.js';
import type { EntitySerializer } from '../types.js';

const sectionSerializer: EntitySerializer<RawSection> = {
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

serializationEngine.attachSectionSerializer(sectionSerializer as EntitySerializer<unknown>);
