import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api-core.js';
import { Dialog } from '../host-ui-kit/overlay/Dialog.js';
import { DirectoryList, normPath } from './DirectoryList.js';

/**
 * HOST-INTERNAL COMPONENT (2.1.20, Host UI Kit slice of M31, owner M31): one
 * implementation, unpublished to plugins, duplicating no catalog anatomy — the
 * window shell is the catalog's `Dialog`, its body the host-internal
 * `DirectoryList`. 2.1.77: its one host consumer is the `directory-browse`
 * window (M26) of the settings dir fields. It is not a catalog entry, so it
 * lives outside `host-ui-kit/`.
 *
 * Settings dir fields (root `dir`, briefs/patches/entities) need a
 * project-cwd-RELATIVE, path-safe string → `mode: 'relative'`, which converts
 * the chosen absolute path against the project cwd (`GET /api/meta`) and
 * rejects a selection outside the project; `mode: 'absolute'` returns the raw
 * absolute path.
 */

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
 * currently-browsed folder (navigate into it, then confirm).
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
        {mode === 'relative' && !projectCwd ? (
          // Wait for the project cwd so the browser can open pinned inside it
          // (start there + clamp `..` at the boundary), never above it.
          <div className="px-2.5 py-3 text-[11.5px]" style={{ color: 'var(--c-subtle)' }}>
            Loading project directory…
          </div>
        ) : (
          <DirectoryList
            onCwdChange={(p) => {
              setCwd(p);
              setError(null);
            }}
            initialPath={mode === 'relative' ? projectCwd ?? undefined : undefined}
            boundaryPath={mode === 'relative' ? projectCwd ?? undefined : undefined}
          />
        )}
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
