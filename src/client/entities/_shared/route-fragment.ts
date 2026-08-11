/**
 * Loosely-typed `createRoute` for an entity's `RouteTreeFragment`.
 *
 * TanStack's route types are inferred from the parent, and a fragment's parent
 * arrives as the opaque `AnyRoute` the module contract hands it — so the strict
 * builder infers `never` for the parent and rejects the result. The external
 * `database-table` plugin already had to widen `createRoute` for exactly this
 * reason; the three in-host fragments hoisted in 0.2.16 need the same escape,
 * and one shared helper is better than four copies of the same cast.
 *
 * The cost is real and bounded: inside a fragment, `to:` targets and
 * `useParams`/`useSearch` are not statically checked against the route tree.
 * That is the price of a route the host does not know by name.
 */

import { createRoute } from '@tanstack/react-router';
import type { AnyRoute } from '@tanstack/react-router';
import type { ComponentType } from 'react';

interface FragmentRouteOptions {
  getParentRoute: () => unknown;
  path: string;
  component: ComponentType;
  validateSearch?: unknown;
  notFoundComponent?: ComponentType;
}

export const makeFragmentRoute = createRoute as unknown as (
  options: FragmentRouteOptions,
) => AnyRoute;
