/**
 * 2.1.26 — the `mcp-tool` records of the five M18 tag write tools on
 * `reference-tools`, as the specification states them at release 2.1.26: name,
 * server, the description the model reads and the declared parameters. Every
 * hint of these records is empty, so no record carries `hints` (the server
 * declares none). Copied from the records, not from the code — the tests that
 * read this file hold the registered tools against it through the shared
 * `expectToolMatchesToolRecord` of `write-tool-records.ts`, and resolve the tag
 * `spec-operation` records' `narzedzia` to `<server>.<tool>` through it.
 */

import type { WriteToolRecord } from './write-tool-records.js';

const ENTITY_TAG_PARAMS: WriteToolRecord['params'] = [
  { name: 'type', type: 'string', required: true },
  { name: 'slug', type: 'string', required: true },
  { name: 'tags', type: 'string[]', required: true },
];

export const TAG_TOOL_RECORDS: Record<string, WriteToolRecord> = {
  'reference-tools-create-tag': {
    server: 'reference-tools',
    name: 'create_tag',
    description:
      'Create a new tag for classifying entities. Returns { slug, name } — the slug is DERIVED from `name`, not supplied.\nYou rarely need this: `tag_entity` creates any tag it does not find, so call this one only to register a tag up front, or to give it a `description` — the one field carrying what the tag MEANS, and the only thing that keeps a taxonomy legible to the next author.',
    params: [
      { name: 'name', type: 'string', required: true, description: 'Display name' },
      { name: 'color', type: 'string', required: false, description: 'Hex color (e.g. #4A90D9)' },
      { name: 'description', type: 'string', required: false },
    ],
  },
  'reference-tools-update-tag': {
    server: 'reference-tools',
    name: 'update_tag',
    description:
      'Update tag properties (name, color, description). If name changes, slug is regenerated and references in pages are updated.',
    params: [
      { name: 'slug', type: 'string', required: true },
      { name: 'data', type: 'object', required: true },
    ],
  },
  'reference-tools-delete-tag': {
    server: 'reference-tools',
    name: 'delete_tag',
    description: 'Delete a tag. Removes all entity-tag assignments (CASCADE).',
    params: [{ name: 'slug', type: 'string', required: true }],
  },
  'reference-tools-tag-entity': {
    server: 'reference-tools',
    name: 'tag_entity',
    description:
      'Add tags to an entity. Idempotent — already assigned tags are skipped. Creates tags if they do not exist. Replaces the entity tag set with the union of existing + new.',
    params: ENTITY_TAG_PARAMS,
  },
  'reference-tools-untag-entity': {
    server: 'reference-tools',
    name: 'untag_entity',
    description: 'Remove tags from an entity.',
    params: ENTITY_TAG_PARAMS,
  },
};
