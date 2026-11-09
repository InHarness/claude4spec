import { useCallback, useEffect, useRef, useState } from 'react';
import { CornerLeftUp, Folder } from 'lucide-react';

/**
 * HOST-INTERNAL COMPONENT (2.1.77, Host UI Kit slice of M31, owner M31): the
 * server-side directory list. One implementation, unpublished to plugins,
 * duplicating no catalog anatomy. Consumers in the host: the create-project
 * page (ui-view `create-project-page`, in the page body, no window) and
 * `DirectoryPickerModal`. It is not a catalog entry, so it lives outside
 * `host-ui-kit/`.
 *
 * `GET /api/workspace/fs` lists ONLY subdirectories under `path` (files
 * skipped); absent `path` starts where the server says — the workspace's home
 * directory when it has one, the process directory otherwise; a leading `~`
 * expands to home. It deals in ABSOLUTE host paths. The selection is the
 * currently-browsed folder (drill into it), reported via `onCwdChange` on every
 * successful navigation (initial load included).
 *
 * Errors are shown INLINE UNDER THE LIST, never as a toast: the listing's own
 * ENOENT / EACCES refusals, and the `error` its consumer passes in — the
 * registration's `PROJECT_PATH_*` refusals on the create-project page.
 *
 * `initialPath` seeds the first listing (undefined → the server's start).
 * `boundaryPath`, when set, clamps upward navigation: the `..` button is hidden
 * once the current folder equals the boundary. `disabled` freezes navigation
 * (e.g. while a registration is in flight).
 */

interface FsEntry {
  name: string;
  path: string;
}

interface FsResponse {
  path: string;
  parent: string | null;
  entries: FsEntry[];
}

export interface DirectoryListProps {
  onCwdChange?: (absPath: string) => void;
  initialPath?: string;
  boundaryPath?: string;
  /** A consumer's error about the selected directory, shown under the list. */
  error?: string | null;
  disabled?: boolean;
}

export function DirectoryList({ onCwdChange, initialPath, boundaryPath, error, disabled }: DirectoryListProps) {
  const [listing, setListing] = useState<FsResponse | null>(null);
  const [browseError, setBrowseError] = useState<string | null>(null);
  // Ref so `browse` stays referentially stable regardless of an inline callback.
  const onCwdChangeRef = useRef(onCwdChange);
  onCwdChangeRef.current = onCwdChange;

  // Browse a directory; `undefined` path → the server's start directory.
  const browse = useCallback((path?: string) => {
    setBrowseError(null);
    const qs = path != null ? `?path=${encodeURIComponent(path)}` : '';
    fetch(`/api/workspace/fs${qs}`)
      .then(async (r) => {
        const body = (await r.json().catch(() => null)) as
          | (FsResponse & { error?: { message?: string } })
          | null;
        if (!r.ok || !body || !('path' in body)) {
          setBrowseError(body?.error?.message ?? `HTTP ${r.status}`);
          return;
        }
        setListing(body);
        onCwdChangeRef.current?.(body.path);
      })
      .catch(() => setBrowseError('Request failed — is the server still running?'));
  }, []);

  useEffect(() => {
    browse(initialPath);
  }, [browse, initialPath]);

  // At the boundary the `..` button is suppressed, so the tree can't go above it.
  const atBoundary =
    boundaryPath != null && listing != null && normPath(listing.path) === normPath(boundaryPath);
  const errors = [browseError, error ?? null].filter((e): e is string => !!e);

  return (
    <div data-testid="directory-list">
      <div className="rounded-md overflow-hidden" style={{ border: '1px solid var(--c-hair)' }}>
        <div
          data-testid="directory-list-path"
          className="px-2.5 py-1.5 text-[11px] font-mono truncate"
          style={{
            background: 'var(--c-panel)',
            color: 'var(--c-subtle)',
            borderBottom: '1px solid var(--c-hair)',
            direction: 'rtl',
            textAlign: 'left',
          }}
          title={listing?.path ?? 'loading…'}
        >
          {listing?.path ?? 'loading…'}
        </div>
        <div className="max-h-52 overflow-y-auto">
          {listing?.parent != null && !atBoundary ? (
            <button
              type="button"
              disabled={disabled}
              onClick={() => browse(listing.parent!)}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-[12px] disabled:opacity-50"
              style={{ color: 'var(--c-muted)' }}
            >
              <CornerLeftUp size={12} style={{ flexShrink: 0 }} />
              ..
            </button>
          ) : null}
          {(listing?.entries ?? []).map((e) => (
            <button
              key={e.path}
              type="button"
              disabled={disabled}
              onClick={() => browse(e.path)}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-[12px] disabled:opacity-50"
              style={{ color: 'var(--c-ink)' }}
            >
              <Folder size={12} style={{ color: 'var(--c-accent)', flexShrink: 0 }} />
              <span className="truncate">{e.name}</span>
            </button>
          ))}
          {listing && listing.entries.length === 0 ? (
            <div className="px-2.5 py-2 text-[11.5px]" style={{ color: 'var(--c-subtle)' }}>
              No subdirectories here.
            </div>
          ) : null}
        </div>
      </div>
      {errors.map((message) => (
        <div
          key={message}
          role="alert"
          data-testid="directory-list-error"
          className="mt-1.5 rounded-md px-2.5 py-1.5 text-[12px]"
          style={{ background: 'rgba(220,38,38,0.08)', color: '#dc2626' }}
        >
          {message}
        </div>
      ))}
    </div>
  );
}

/** Normalize a host path for prefix comparison: `/`-sep, no trailing slash. */
export function normPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '');
}
