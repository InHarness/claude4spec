/**
 * The pane a route body sits in, and the editor bridge a description needs.
 *
 * Both are invisible to a typecheck and to `curl`: the page renders, answers
 * 200 and logs nothing either way. They are here because getting them wrong is
 * how the same two bugs keep reappearing whenever routes leave the host.
 */

import { useMemo, type FC, type ReactNode } from 'react';
import { EditorBridgeProvider } from '@c4s/plugin-runtime';
import { toEntity, toSection, type Navigate } from '../entity/mcp-tool/frontend/navigation.js';

/**
 * The host's `RoutePane`, faithfully: `flex-1 flex flex-col min-w-0 h-full`, and
 * it does NOT scroll.
 *
 * Dropping `display: flex` and adding `overflow: auto` reads like a harmless
 * simplification and is not: every child laid out as a flex item stops being
 * one. The list layout and the detail panel are built as `flex-1 overflow-auto`
 * bodies under a fixed header, so under a block parent their height collapses to
 * auto, their own scroll container never engages, and the whole page scrolls in
 * the pane instead — carrying the breadcrumb bar and the search/filter header
 * out of the viewport, where in the host they stay put.
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
 * A route body containing a `DocEditor` — i.e. the entity detail, whose
 * description is one — wrapped in the editor bridge the host supplies to its own
 * routes.
 *
 * Without it `DocEditor` resolves no bridge from context and falls back to its
 * internal no-op, so clicking an entity chip inside a description does nothing.
 * It is worse than local: `DocEditor` publishes whatever bridge it has into the
 * process-wide singleton for as long as it is mounted, so that no-op also
 * disables chips rendered outside this React tree.
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
