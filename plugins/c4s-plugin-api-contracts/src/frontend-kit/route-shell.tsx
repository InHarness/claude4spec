/**
 * The two things every route this package contributes has to get right, and got
 * wrong when these routes moved out of the host's `router.tsx`.
 *
 * Both are invisible to a typecheck and to `curl`: the page renders, returns
 * 200, and logs nothing.
 */

import { useMemo, type FC, type ReactNode } from 'react';
import { EditorBridgeProvider } from '@c4s/plugin-runtime';
import { toEntity, toSection, type Navigate } from './navigation.js';

/**
 * The pane a route body sits in — the host's `RoutePane`, faithfully.
 *
 * The host's is `flex-1 flex flex-col min-w-0 h-full` and does NOT scroll. The
 * first copy here dropped `display: flex` and added `overflow: auto`, which
 * reads like a harmless simplification and is not: every child laid out as a
 * flex item stops being one. `ListPageLayout` and the detail panels are built as
 * `flex-1 overflow-auto` bodies under a fixed header, so with a block parent the
 * body's height collapses to auto, its own scroll container never engages, and
 * the whole page scrolls in the pane instead — carrying the breadcrumb bar and
 * the search/filter header out of the viewport, where in the host they stay put.
 */
export const Pane: FC<{ children: ReactNode }> = ({ children }) => (
  <main
    style={{
      flex: 1,
      minWidth: 0,
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--c-bg)',
    }}
  >
    {children}
  </main>
);

/**
 * A route body containing a `DocEditor` — i.e. any entity detail with a
 * description — wrapped in the editor bridge the host's deleted routes supplied.
 *
 * Without it `DocEditor` resolves no bridge from context and falls back to its
 * internal no-op, so clicking an entity chip inside the description does
 * nothing. It is worse than local: `DocEditor` publishes whatever bridge it has
 * into the process-wide singleton for as long as it is mounted, so that no-op
 * also disables chips rendered outside this React tree.
 *
 * `openEntity` goes through the host's navigation helper rather than a local
 * route push, because the target is any entity type — including ones this
 * package knows nothing about.
 */
export const RouteBody: FC<{ navigate: Navigate; children: ReactNode }> = ({
  navigate,
  children,
}) => {
  const bridge = useMemo(
    () => ({
      openEntity: (type: string, slug: string) => toEntity(navigate, type, slug),
      openSection: (pagePath: string, anchor: string) => toSection(navigate, pagePath, anchor),
    }),
    [navigate],
  );
  return (
    <Pane>
      <EditorBridgeProvider bridge={bridge}>{children}</EditorBridgeProvider>
    </Pane>
  );
};
