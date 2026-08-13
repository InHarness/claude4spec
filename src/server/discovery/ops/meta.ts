/**
 * M39 — the two orientation operations.
 *
 * `overview` is the ENTRY POINT. The session that motivated this module spent
 * thirteen turns guessing at file paths because nothing answered "what is here
 * and how do I address it". So root properties are a mandatory part of the
 * payload, not a detail: an agent has to know up front whether hits from a root
 * arrive as an `anchor` or as `(rootId, path, line)`.
 *
 * `overview` failing must not push an agent back to guessing, which is why it
 * touches as little as possible — only pure-data manifest slots, never a
 * derived schema. Schema emission lives in `describe_types` alone, so one
 * broken type cannot take orientation down with it.
 */

import type { DiscoveryDeps, DescribeTypesInput, DescribeTypesResult, OverviewResult } from '../types.js';
import { invalidType } from '../errors.js';
import {
  constraintsOf,
  contentFieldsOf,
  selectableFieldsOf,
} from '../../../shared/plugin-host/data-schema.js';
import { PageSource } from '../page-source.js';
import { RootSet } from '../roots.js';
import { resolveSearchFields } from '../search/fields.js';

export async function overview(deps: DiscoveryDeps, pages: PageSource, roots: RootSet): Promise<OverviewResult> {
  const catalog = deps.serialization.catalog(deps.reader);

  const rootEntries: OverviewResult['roots'] = [];
  for (const root of roots.all) {
    let pageCount = 0;
    try {
      pageCount = (await pages.list(root.id)).length;
    } catch {
      // A root whose directory is missing is reported as empty rather than
      // failing orientation for every other root.
    }
    rootEntries.push({
      id: root.id,
      name: root.name,
      sectionIndexed: root.sectionIndexed,
      referenceValidated: root.referenceValidated,
      pageCount,
    });
  }

  const types: OverviewResult['types'] = {};
  for (const [type, entry] of Object.entries(catalog.types)) {
    types[type] = {
      count: entry.count,
      payloadVersion: entry.payloadVersion,
      description: entry.description,
      roleNoun: entry.roleNoun,
      ...(entry.mcpToolsLine ? { mcpToolsLine: entry.mcpToolsLine } : {}),
    };
  }

  return {
    roots: rootEntries,
    types,
    tagCount: deps.reader.listTags().length,
    claude4spec: deps.packageVersion,
  };
}

export function describeTypes(deps: DiscoveryDeps, input: DescribeTypesInput = {}): DescribeTypesResult {
  const active = deps.host.listEntities();
  const activeTypes = active.map((m) => m.type);
  const wanted = input.types?.length ? input.types : activeTypes;

  const types: DescribeTypesResult['types'] = [];
  for (const type of wanted) {
    const module = deps.host.getEntity(type);
    // A type deactivated in `config.entities` is INVALID_TYPE with the active
    // list attached — never a silent fall-back to raw JSON, which would make a
    // deactivated type look half-alive.
    if (!module) throw invalidType(type, activeTypes);
    const described = deps.serialization.describe(type);
    if (!described) throw invalidType(type, activeTypes);
    const schema = module.data?.schema ?? {};
    types.push({
      type,
      label: module.label,
      payloadVersion: described.payloadVersion,
      schemas: described.schemas,
      /**
       * Four lists, all DERIVED by the host and none declared by the type.
       *
       * `views` used to sit here and no longer does: a caller cannot choose one,
       * so publishing the repertoire advertised a decision that is not theirs.
       * What replaced it answers the questions a caller now actually has before
       * a READ — what may I project, what will search cover, what is content and
       * how do I fetch it, and what values will be refused on write.
       */
      constraints: constraintsOf(schema),
      contentFields: contentFieldsOf(schema),
      selectableFields: selectableFieldsOf(schema),
      searchableFields: resolveSearchFields(module, undefined).map((f) => f.path),
    });
  }
  return { types };
}
