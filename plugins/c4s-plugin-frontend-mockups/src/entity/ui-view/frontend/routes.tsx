/**
 * The `/ui-views` route tree, contributed as a `RouteTreeFragment`.
 *
 * 0.2.16 hoisted these out of the host's `BASE_ROUTE_CHILDREN`; 0.2.18 moves
 * them out of the host repo entirely, into this envelope.
 *
 * 0.2.28 gave the type the topbar every other entity type already had. There
 * was no history route here — the note this replaces said the breadcrumb "never
 * advertised one for this type", which described the omission rather than
 * justifying it — and now there are three views: the detail form, the mockup
 * `preview`, and `history`. A view is a ROUTE plus a segment in the switcher;
 * the active one is read off the URL, never held in state, so a deep link to
 * any tab renders with that tab active.
 *
 * `AnyRoute` is opaque in the Host API and TanStack's hooks are typed against
 * the host's own route tree, so the factory and the params/search reads are
 * loosely typed here rather than at every call site.
 */

import type { FC } from 'react';
import { createRoute, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import type { RouteTreeFragment } from '@c4s/plugin-runtime';
import { UI_VIEW_PATH_PREFIX, UI_VIEW_TYPE } from '../../../identity.js';
import { EntityBreadcrumbBar } from '../../../frontend-kit/EntityBreadcrumbBar.js';
import { EntityNotFound } from '../../../frontend-kit/EntityNotFound.js';
import { toDetail, toEntity, toList, toPage, type Navigate } from '../../../frontend-kit/navigation.js';
import { Pane, RouteBody } from '../../../frontend-kit/route-shell.js';
import { useUiView } from './hooks.js';
import { UiViewsList } from './list-page.js';
import { UiViewDetail } from './detail-panel.js';
import { UiViewOpenExternal, UiViewPreview } from './preview-page.js';
import { EntityVersionHistoryView } from '@c4s/plugin-runtime/ui';
import type { EntityView } from '../../../frontend-kit/EntityViewSwitcher.js';

/** Three, unlike the default pair — `preview` is this type's own. */
const UI_VIEW_VIEWS: readonly EntityView[] = ['details', 'preview', 'history'];

type ListSearch = { q?: string; tag?: string };

function UiViewsIndexRoute() {
  const search = useSearch({ strict: false }) as ListSearch;
  const navigate = useNavigate() as Navigate;
  return (
    <Pane>
      <UiViewsList
        search={search.q ?? ''}
        tagFilter={search.tag ? [search.tag] : []}
        onSearchChange={(q) =>
          navigate({
            to: UI_VIEW_PATH_PREFIX,
            search: (prev: ListSearch) => ({ ...prev, q: q || undefined }),
          })
        }
        onTagToggle={(tag) =>
          navigate({
            to: UI_VIEW_PATH_PREFIX,
            search: (prev: ListSearch) => ({ ...prev, tag: prev.tag === tag ? undefined : tag }),
          })
        }
        onSelect={(slug) => toDetail(navigate, UI_VIEW_PATH_PREFIX, slug)}
      />
    </Pane>
  );
}

function UiViewDetailRoute() {
  const { slug } = useParams({ strict: false }) as { slug: string };
  const navigate = useNavigate() as Navigate;
  const { data: uiView } = useUiView(slug);

  return (
    // RouteBody, not Pane: the detail panel renders a DocEditor for the
    // description, and the chips inside it need the host's editor bridge.
    <RouteBody navigate={navigate}>
      <EntityBreadcrumbBar
        type={UI_VIEW_TYPE}
        slug={slug}
        name={uiView?.title}
        view="details"
        views={UI_VIEW_VIEWS}
      />
      <UiViewDetail
        // Resets the draft when navigating straight between two views.
        key={slug}
        slug={slug}
        onDeleted={() => toList(navigate, UI_VIEW_PATH_PREFIX)}
        onRenamed={(newSlug) => toDetail(navigate, UI_VIEW_PATH_PREFIX, newSlug, { replace: true })}
        onOpenEntity={(type, s) => toEntity(navigate, type, s)}
        onOpenPage={(rootId, path) => toPage(navigate, rootId, path)}
      />
    </RouteBody>
  );
}

/**
 * `Pane`, not `RouteBody`: the editor bridge exists for the detail form's
 * `DocEditor`, and neither of these two views renders one.
 */
function UiViewPreviewRoute() {
  const { slug } = useParams({ strict: false }) as { slug: string };
  const { data: uiView } = useUiView(slug);
  return (
    <Pane>
      <EntityBreadcrumbBar
        type={UI_VIEW_TYPE}
        slug={slug}
        name={uiView?.title}
        view="preview"
        views={UI_VIEW_VIEWS}
        // Only this view. The action opens the document the frame below shows,
        // so it has no meaning on the detail form or the history timeline.
        actions={<UiViewOpenExternal slug={slug} />}
      />
      <UiViewPreview slug={slug} />
    </Pane>
  );
}

function UiViewHistoryRoute() {
  const { slug } = useParams({ strict: false }) as { slug: string };
  const { data: uiView } = useUiView(slug);
  return (
    <Pane>
      <EntityBreadcrumbBar
        type={UI_VIEW_TYPE}
        slug={slug}
        name={uiView?.title}
        view="history"
        views={UI_VIEW_VIEWS}
      />
      <EntityVersionHistoryView type={UI_VIEW_TYPE} slug={slug} />
    </Pane>
  );
}

export const uiViewRoutes: RouteTreeFragment = ({ rootRoute }) => {
  const make = createRoute as unknown as (opts: {
    getParentRoute: () => unknown;
    path: string;
    component: FC;
    notFoundComponent?: FC;
  }) => unknown;
  return [
    make({ getParentRoute: () => rootRoute, path: UI_VIEW_PATH_PREFIX, component: UiViewsIndexRoute }),
    make({
      getParentRoute: () => rootRoute,
      path: `${UI_VIEW_PATH_PREFIX}/$slug`,
      component: UiViewDetailRoute,
      notFoundComponent: () => <EntityNotFound type={UI_VIEW_TYPE} />,
    }),
    make({
      getParentRoute: () => rootRoute,
      path: `${UI_VIEW_PATH_PREFIX}/$slug/preview`,
      component: UiViewPreviewRoute,
      notFoundComponent: () => <EntityNotFound type={UI_VIEW_TYPE} />,
    }),
    make({
      getParentRoute: () => rootRoute,
      path: `${UI_VIEW_PATH_PREFIX}/$slug/history`,
      component: UiViewHistoryRoute,
      notFoundComponent: () => <EntityNotFound type={UI_VIEW_TYPE} />,
    }),
  ];
};
