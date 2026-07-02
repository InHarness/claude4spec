import { useCallback, useEffect, useRef, useState } from 'react';
import { CornerLeftUp, Folder } from 'lucide-react';
import { apiFetch } from '../../lib/api-core.js';
import { Dialog } from './Dialog.js';

/**
 * 0.1.97: the server-side directory browser, extracted from `AddProjectDialog`
 * so every dir input can reuse it. `GET /api/workspace/fs` lists ONLY
 * subdirectories under `path` (files skipped); absent `path` starts at the
 * process CWD; a leading `~` expands to home. It deals in ABSOLUTE host paths.
 *
 * Two consumers with different path semantics:
 * - `AddProjectDialog` embeds `DirectoryBrowser` directly and posts an absolute
 *   `cwd` → `mode: 'absolute'` picker semantics.
 * - Settings dir fields (root `dir`, briefs/patches/entities) need a
 *   project-cwd-RELATIVE, path-safe string → `mode: 'relative'`, which converts
 *   the chosen absolute path against the project cwd (`GET /api/meta`) and
 *   rejects a selection outside the project.
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

/**
 * Presentational directory list backed by `GET /api/workspace/fs`. Owns its own
 * listing + browse-error state; reports the current absolute path via
 * `onCwdChange` on every successful navigation (initial load included).
 */
export function DirectoryBrowser({ onCwdChange }: { onCwdChange?: (absPath: string) => void }) {
  const [listing, setListing] = useState<FsResponse | null>(null);
  const [browseError, setBrowseError] = useState<string | null>(null);
  // Ref so `browse` stays referentially stable regardless of an inline callback.
  const onCwdChangeRef = useRef(onCwdChange);
  onCwdChangeRef.current = onCwdChange;

  // Browse a directory; `undefined` path → server CWD (initial load).
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
    browse();
  }, [browse]);

  return (
    <div className="rounded-md overflow-hidden" style={{ border: '1px solid var(--c-hair)' }}>
      <div
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
        {listing?.parent != null ? (
          <button
            type="button"
            onClick={() => browse(listing.parent!)}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-[12px]"
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
            onClick={() => browse(e.path)}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-[12px]"
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
        {browseError ? (
          <div className="px-2.5 py-2 text-[11.5px]" style={{ color: '#dc2626' }}>
            {browseError}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Normalize a host path for prefix comparison: `/`-sep, no trailing slash. */
function normPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '');
}

/**
 * Convert a chosen absolute path to a project-cwd-relative string, or `null` if
 * it is not inside the project cwd. `chosen === cwd` → `.` (the project root
 * itself). Mirrors the safety the server's `validateRootDirs` enforces.
 */
export function toProjectRelative(projectCwd: string, chosen: string): string | null {
  const base = normPath(projectCwd);
  const target = normPath(chosen);
  if (target === base) return '.';
  if (target.startsWith(base + '/')) return target.slice(base.length + 1);
  return null;
}

export interface DirectoryPickerModalProps {
  open: boolean;
  onClose: () => void;
  /**
   * `absolute` returns the raw absolute path; `relative` converts it to a
   * project-cwd-relative, path-safe string (rejecting selections outside cwd).
   */
  mode: 'absolute' | 'relative';
  /** Called with the resolved value when the user confirms. */
  onSelect: (value: string) => void;
  title?: string;
}

/**
 * Modal directory picker built on the `Dialog` shell. The selection is the
 * currently-browsed folder (navigate into it, then confirm) — mirroring
 * `AddProjectDialog`, where the chosen `cwd` is the folder you drill into.
 */
export function DirectoryPickerModal({
  open,
  onClose,
  mode,
  onSelect,
  title = 'Choose a directory',
}: DirectoryPickerModalProps) {
  const [cwd, setCwd] = useState('');
  const [projectCwd, setProjectCwd] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reset transient state each time the modal opens.
  useEffect(() => {
    if (!open) return;
    setError(null);
    if (mode !== 'relative') return;
    // Project cwd for absolute→relative conversion (project-scoped endpoint).
    apiFetch('/api/meta')
      .then(async (r) => {
        const body = (await r.json().catch(() => null)) as { cwd?: string } | null;
        if (body?.cwd) setProjectCwd(body.cwd);
      })
      .catch(() => {
        /* leave projectCwd null → confirm surfaces an inline error */
      });
  }, [open, mode]);

  function confirm() {
    const chosen = cwd.trim();
    if (!chosen) return;
    if (mode === 'absolute') {
      onSelect(chosen);
      onClose();
      return;
    }
    if (!projectCwd) {
      setError('Could not determine the project directory — try again.');
      return;
    }
    const rel = toProjectRelative(projectCwd, chosen);
    if (rel == null) {
      setError('Selected folder is outside the project directory. Pick a folder inside it.');
      return;
    }
    onSelect(rel);
    onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="px-2.5 py-1 rounded-md text-[11.5px]"
            style={{ color: 'var(--c-muted)' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={!cwd.trim()}
            className="px-2.5 py-1 rounded-md text-[11.5px] font-medium disabled:opacity-50"
            style={{ background: 'var(--c-accent)', color: '#fff' }}
          >
            Use this folder
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <DirectoryBrowser
          onCwdChange={(p) => {
            setCwd(p);
            setError(null);
          }}
        />
        {error ? (
          <div
            className="rounded-md px-2.5 py-1.5 text-[12px]"
            style={{ background: 'rgba(220,38,38,0.08)', color: '#dc2626' }}
          >
            {error}
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
