import { useCallback, useEffect, useState } from 'react';
import { CornerLeftUp, Folder, FolderPlus, Plus, X } from 'lucide-react';
import { toast } from '../ui/events.js';

interface Props {
  onClose: () => void;
}

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
 * M31 + decision #11: register a project into the current workspace. A
 * server-side directory browser (GET /api/workspace/fs — directories only,
 * starts at the process CWD, `~` expands) drives the selection; the resolved
 * path is also editable by hand. On success the app does a full reload into
 * `/p/<id>/` because PROJECT_ID / API_BASE / router basepath are module-load
 * constants. Both endpoints are workspace-scope (raw fetch, no project prefix).
 */
export function AddProjectDialog({ onClose }: Props) {
  const [cwd, setCwd] = useState('');
  const [listing, setListing] = useState<FsResponse | null>(null);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        setCwd(body.path);
      })
      .catch(() => setBrowseError('Request failed — is the server still running?'));
  }, []);

  useEffect(() => {
    browse();
  }, [browse]);

  async function submit() {
    const trimmed = cwd.trim();
    if (!trimmed || pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch('/api/workspace/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cwd: trimmed }),
      });
      const body = (await res.json().catch(() => null)) as
        | { project?: { id: string; name: string }; error?: { message?: string } }
        | null;
      if (!res.ok || !body?.project) {
        setError(body?.error?.message ?? `HTTP ${res.status}`);
        setPending(false);
        return;
      }
      toast.success(`Project "${body.project.name}" added to workspace`);
      // Full reload into the new project — module-load constants must re-init.
      window.location.href = `/p/${body.project.id}/`;
    } catch {
      setError('Request failed — is the server still running?');
      setPending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.35)' }}>
      <div
        className="rounded-lg shadow-2xl"
        style={{
          width: 480,
          background: 'var(--c-card)',
          border: '1px solid var(--c-hair-strong)',
        }}
      >
        <div
          className="px-3 pt-3 flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider"
          style={{ color: 'var(--c-subtle)' }}
        >
          <FolderPlus size={12} style={{ color: 'var(--c-accent)' }} />
          Add project to workspace
          <span className="flex-1" />
          <button onClick={onClose} style={{ color: 'var(--c-muted)' }} className="ml-2">
            <X size={13} />
          </button>
        </div>
        <div className="p-3 space-y-3">
          {/* Server-side directory browser */}
          <div
            className="rounded-md overflow-hidden"
            style={{ border: '1px solid var(--c-hair)' }}
          >
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

          <label className="flex flex-col gap-1.5">
            <span className="text-[11.5px] font-medium uppercase tracking-wide" style={{ color: 'var(--c-muted)' }}>
              Project directory
            </span>
            <input
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit();
              }}
              className="w-full rounded-md px-2.5 py-1.5 text-[12.5px] font-mono outline-none"
              style={{
                background: 'var(--c-panel)',
                border: '1px solid var(--c-hair)',
                color: 'var(--c-ink)',
              }}
              placeholder="/absolute/path/to/project"
            />
          </label>
          <p className="text-[11.5px]" style={{ color: 'var(--c-subtle)' }}>
            The directory is bootstrapped on registration (config, pages, entities) — an empty
            directory becomes a fresh project.
          </p>

          {error ? (
            <div
              className="rounded-md px-2.5 py-1.5 text-[12px]"
              style={{ background: 'rgba(220,38,38,0.08)', color: '#dc2626' }}
            >
              {error}
            </div>
          ) : null}

          <div className="flex items-center gap-2 pt-1">
            <span className="flex-1" />
            <button
              onClick={onClose}
              className="px-2.5 py-1 rounded-md text-[11.5px]"
              style={{ color: 'var(--c-muted)' }}
            >
              Cancel
            </button>
            <button
              onClick={() => void submit()}
              disabled={!cwd.trim() || pending}
              className="px-2.5 py-1 rounded-md text-[11.5px] font-medium inline-flex items-center gap-1.5"
              style={{ background: 'var(--c-accent)', color: '#fff', opacity: cwd.trim() ? 1 : 0.5 }}
            >
              <Plus size={11} /> {pending ? 'Adding…' : 'Add project'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
