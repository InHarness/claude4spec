/**
 * The slice of `MountContext` this envelope uses, declared structurally — the
 * same device `c4s-plugin-ac` uses: the audit reads records through the bound
 * read operations and nothing else, so a widening of `MountContext` cannot
 * silently widen this package's reach.
 */

import type { GetEntitiesInput, GetEntitiesResult, ListEntitiesInput, ListEntitiesResult } from '@c4s/plugin-runtime';

export interface ReadOps {
  getEntities(input: GetEntitiesInput): GetEntitiesResult;
  listEntities(input: ListEntitiesInput): ListEntitiesResult;
}
