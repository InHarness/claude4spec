import { useEffect } from 'react';
import { Link, Outlet } from '@tanstack/react-router';
import { Settings as SettingsIcon } from 'lucide-react';
import { AppBranding } from './AppBranding.js';
import { WorkspaceHeaderEntry } from '../workspace/WorkspaceHeaderEntry.js';

/**
 * M50 `1bd92aq2` — the frame of the WORKSPACE routes (a route declares its kind
 * through `staticData.routeKind`, L5 `tehej2wz`). A workspace route has no
 * project, so the frame renders none of what assumes one: no project sidebar,
 * no chat overlay, no chat handle, no staleness bar — and it does not connect
 * to the event channel (no `useFileWatcher`): a workspace page has no live
 * project data to invalidate. One bar above the outlet: the application
 * branding (a shell element) and, beside it, the `Nagłówek` slot entries of the
 * workspace route, whose content their module declares (M31). One frame serves
 * every workspace route. The bar's other shell element is the gear to the
 * workspace settings page (`/workspace/settings`, M26 `m26route`) — the way the
 * project route's gear leads to `/settings`.
 */
export function WorkspaceFrame() {
  // The theme needs nothing here: the document's inline theme script ran before
  // mount, and the OS-scheme subscription lives at `themeStore` module scope.
  useEffect(() => {
    document.title = 'claude4spec';
  }, []);

  return (
    <div
      className="h-full w-full flex flex-col"
      style={{ background: 'var(--c-bg)', color: 'var(--c-ink)' }}
      data-testid="workspace-frame"
    >
      <header
        className="shrink-0 flex items-center gap-2 px-3.5 py-2"
        style={{ background: 'var(--c-panel)', borderBottom: '1px solid var(--c-hair)' }}
        data-testid="workspace-frame-bar"
      >
        <AppBranding />
        <WorkspaceHeaderEntry />
        <Link
          to="/workspace/settings"
          className="shrink-0 rounded p-1"
          style={{ color: 'var(--c-muted)' }}
          title="Workspace settings"
          aria-label="Open workspace settings"
        >
          <SettingsIcon size={13} />
        </Link>
      </header>
      <div className="flex-1 min-h-0 w-full flex">
        <Outlet />
      </div>
    </div>
  );
}
