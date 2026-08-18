import { useNavigate } from '@tanstack/react-router';
import { SegmentedControlTabs } from '@c4s/plugin-runtime/ui';
import { clientPluginHost } from '@c4s/plugin-runtime';
import type { EntityType } from '../types.js';

/**
 * HOST-LOCAL, and the gap it names is ROUTING — not the control.
 *
 * The segmented control itself now comes from the Host UI Kit
 * (`SegmentedControlTabs`, L12). Until 0.2.32 this file drove a hand-written
 * `SegmentedControl` + `ButtonGroup` pair living beside it, which was a copy of
 * a component the catalog already carried: two implementations of one anatomy,
 * with only one of them receiving the original's fixes. Both files are gone.
 * `experimental` was never a reason to keep them — the tier withdraws the
 * prop-stability guarantee and nothing else, and it gates no import; a catalog
 * component is imported the same way from a host module, a built-in envelope and
 * a third-party plugin alike.
 *
 * What stays local is the part above the control: turning a view into a ROUTE.
 * The catalog component is deliberately presentational — `active` and `onChange`
 * are props, it holds no state and knows nothing of a router — so the mapping
 * from a view name to a path segment under this type's `pathPrefix`, and the
 * `navigate` call that performs it, have nowhere in the catalog to live. That is
 * the surface gap, and this wrapper shrinks to nothing the day the catalog grows
 * a routed variant.
 *
 * Note what the swap changed for anyone asserting on this: the tab is now
 * `role="tab"` with `aria-selected`, where the local copy emitted a plain button
 * with `aria-pressed`. The per-view icons went with it — the catalog props are
 * `{ id, label }`, and re-vendoring an icon-capable copy to keep them would
 * recreate exactly the anti-pattern this removed.
 */

/**
 * The views a type can advertise in its topbar.
 *
 * `preview` joined in 0.2.28 for `ui-view`'s mockup document. It is a VIEW of
 * the entity, not a field of it — a screen mockup wants the pane, not a form
 * row — so it belongs on the same axis as details and history.
 */
export type EntityView = 'details' | 'preview' | 'history';

interface Props {
  type: EntityType;
  slug: string;
  view: EntityView;
  /**
   * Which views this type actually has ROUTES for, in the order they appear.
   *
   * Defaults to the app's basic pattern — details plus history — which every
   * other entity type already follows. A type only names this explicitly to
   * add to it.
   */
  views?: readonly EntityView[];
}

const LABELS: Record<EntityView, string> = {
  details: 'Details',
  preview: 'Preview',
  history: 'History',
};

export const DEFAULT_VIEWS: readonly EntityView[] = ['details', 'history'];

export function EntityViewSwitcher({ type, slug, view, views = DEFAULT_VIEWS }: Props) {
  const navigate = useNavigate();
  // Method call — see the note in EntityBreadcrumbBar on why never a local.
  const prefix = clientPluginHost.getAvailable(type)?.pathPrefix ?? '';

  return (
    <SegmentedControlTabs
      active={view}
      tabs={views.map((v) => ({ id: v, label: LABELS[v] }))}
      onChange={(id) => {
        const next = id as EntityView;
        // Clicking the active tab is a guarded no-op rather than a re-navigation
        // to the URL we are already on.
        if (next === view) return;
        navigate({
          // `details` is the bare detail route; every other view is a child
          // segment named after itself, which is what makes the active tab a
          // function of the URL rather than of any state held here.
          to: next === 'details' ? `${prefix}/$slug` : `${prefix}/$slug/${next}`,
          params: { slug },
        } as never);
      }}
    />
  );
}
