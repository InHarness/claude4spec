import { useEffect, useRef, useState } from 'react';
import { ChevronsUpDown, Check, Plus } from 'lucide-react';
import { PROJECT_ID } from '../lib/api-core.js';
import { AddProjectDialog } from './AddProjectDialog.js';
import { Skeleton } from '../ui/Skeleton.js';
import { toast } from '../ui/events.js';

interface WorkspaceProject {
  id: string;
  name: string;
  cwd: string;
  live: boolean;
}

interface WorkspaceResponse {
  name: string;
  projects: WorkspaceProject[];
}

/**
 * M31: workspace project switcher — replaces the static project-name block in
 * the sidebar header. Lists `GET /api/workspace` projects (plain fetch —
 * workspace scope, NOT the project-prefixed apiFetch); picking one does a
 * full reload to `/p/<id>/`, required because PROJECT_ID / API_BASE /
 * PROJECT_SCOPE / router basepath are module-load constants.
 */
export function ProjectSwitcher({
  projectName,
  cwdPath,
  loading = false,
}: {
  projectName: string | null;
  cwdPath: string;
  loading?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [showAddProject, setShowAddProject] = useState(false);
  const [workspace, setWorkspace] = useState<WorkspaceResponse | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    fetch('/api/workspace')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: WorkspaceResponse | null) => d && setWorkspace(d))
      .catch(() => {
        /* keep empty — switcher degrades to the static label */
      });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const displayName = projectName ?? (cwdPath.split('/').filter(Boolean).pop() ?? cwdPath);
  const toggle = () => setOpen((v) => !v);

  async function revealFolder() {
    try {
      const res = await fetch('/api/workspace/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cwd: cwdPath }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        toast.error(body?.error?.message ?? `Could not open folder (HTTP ${res.status})`);
      }
    } catch {
      toast.error('Could not open folder — is the server still running?');
    }
  }

  return (
    <div ref={rootRef} className="relative flex-1 min-w-0">
      {loading ? (
        <div className="w-full flex items-center gap-1">
          <span className="flex-1 min-w-0 py-0.5">
            <Skeleton width="60%" height={11} />
            <Skeleton width="40%" height={9} className="mt-1.5" />
          </span>
          <ChevronsUpDown size={12} style={{ color: 'var(--c-subtle)', flexShrink: 0 }} />
        </div>
      ) : (
        <div className="w-full flex items-center gap-1">
          <span className="flex-1 min-w-0">
            <button
              type="button"
              onClick={toggle}
              className="block w-full text-left text-[13px] font-semibold tracking-tight truncate"
              title={displayName}
              aria-haspopup="listbox"
              aria-expanded={open}
            >
              {displayName}
            </button>
            <button
              type="button"
              onClick={revealFolder}
              className="block w-full text-left text-[10.5px] -mt-0.5 truncate hover:underline"
              style={{ color: 'var(--c-subtle)', direction: 'rtl', textAlign: 'left' }}
              title={`${cwdPath} — open in file manager`}
            >
              {cwdPath}
            </button>
          </span>
          <button type="button" onClick={toggle} aria-label="Switch project">
            <ChevronsUpDown size={12} style={{ color: 'var(--c-subtle)', flexShrink: 0 }} />
          </button>
        </div>
      )}

      {open ? (
        <div
          role="listbox"
          className="absolute left-0 top-full z-50 mt-1 w-64 rounded-md py-1 shadow-lg"
          style={{ background: 'var(--c-card)', border: '1px solid var(--c-hair-strong)' }}
        >
          <div
            className="px-3 py-1 text-[10px] font-medium uppercase tracking-wide"
            style={{ color: 'var(--c-subtle)' }}
          >
            {workspace ? `Workspace · ${workspace.name}` : 'Workspace'}
          </div>
          {!workspace
            ? [0, 1, 2].map((i) => (
                <div key={`sk-${i}`} className="flex items-center gap-2 px-3 py-1.5">
                  <span className="flex-1 min-w-0">
                    <Skeleton width="55%" height={11} />
                    <Skeleton width="75%" height={9} className="mt-1.5" />
                  </span>
                </div>
              ))
            : null}
          {(workspace?.projects ?? []).map((p) => {
            const current = p.id === PROJECT_ID;
            return (
              <button
                key={p.id}
                type="button"
                role="option"
                aria-selected={current}
                onClick={() => {
                  if (current) {
                    setOpen(false);
                    return;
                  }
                  // Full reload — module-load constants must re-initialize.
                  window.location.href = `/p/${p.id}/`;
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left"
                style={{
                  color: 'var(--c-ink)',
                  background: current ? 'var(--c-hair)' : 'transparent',
                }}
              >
                <span className="flex-1 min-w-0">
                  <span className="block text-[12.5px] font-medium truncate">{p.name}</span>
                  <span
                    className="block text-[10.5px] font-mono truncate"
                    style={{ color: 'var(--c-subtle)', direction: 'rtl', textAlign: 'left' }}
                    title={p.cwd}
                  >
                    {p.cwd}
                  </span>
                </span>
                {current ? <Check size={12} style={{ color: 'var(--c-accent)', flexShrink: 0 }} /> : null}
              </button>
            );
          })}
          {workspace && workspace.projects.length === 0 ? (
            <div className="px-3 py-1.5 text-[11.5px]" style={{ color: 'var(--c-subtle)' }}>
              No projects registered.
            </div>
          ) : null}
          <div className="my-1" style={{ borderTop: '1px solid var(--c-hair)' }} />
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setShowAddProject(true);
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[12.5px]"
            style={{ color: 'var(--c-muted)' }}
          >
            <Plus size={12} style={{ flexShrink: 0 }} />
            Add project…
          </button>
        </div>
      ) : null}

      {showAddProject ? <AddProjectDialog onClose={() => setShowAddProject(false)} /> : null}
    </div>
  );
}
