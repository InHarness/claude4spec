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
 * touches as little as possible — only pure-data manifest slots, never
 * `serializer.schema`. Schema emission lives in `describe_types` alone, so one
 * broken serializer cannot take orientation down with it.
 */

import type { DiscoveryDeps, DescribeTypesInput, DescribeTypesResult, OverviewResult } from '../types.js';
import type { ViewKind } from '../../serialization/types.js';
import { invalidType } from '../errors.js';
import { PageSource } from '../page-source.js';
import { RootSet } from '../roots.js';
import { hostDefaultFields, resolveSearchFields } from '../search/fields.js';

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
      version: entry.version,
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
    const described = deps.serialization.describe(type, input.view as ViewKind | undefined, deps.db);
    if (!described) throw invalidType(type, activeTypes);
    types.push({
      type,
      label: module.label,
      version: described.version,
      views: described.views,
      schemas: described.schemas,
      // The answer to "what will search cover for this type" belongs with the
      // answer to "what shape is it" — one call, not two.
      searchableFields: resolveSearchFields(module, undefined).map((f) => f.path),
    });
  }
  return { types };
}

/** Exported for `describe_entity_type`, which reports the same list per type. */
export function searchableFieldsOf(deps: DiscoveryDeps, type: string): string[] {
  const module = deps.host.getEntity(type);
  if (!module) return [];
  return resolveSearchFields(module, undefined).map((f) => f.path);
}

export { hostDefaultFields };
