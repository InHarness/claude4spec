/**
 * DEBT (2.1.20, Host UI Kit slice of M31): the `project-create` window draws
 * its own scrim and panel. It fails locality condition 2 — a window shell does
 * not follow from anything project-specific and repeats with every form window.
 * Its catalog replacement is `Dialog`. Recorded, not fixed here.
 */
import { useState } from 'react';
import { FolderPlus, Plus, X } from 'lucide-react';
import { toast } from '../events.js';
import { navigateDocument } from '../../lib/document-nav.js';
import { DirectoryBrowser } from '../../components/DirectoryPickerModal.js';
import type { ModalFormProps } from '../ModalHost.js';

/**
 * M31 + decision #11: register a project into the current workspace. A
 * server-side directory browser (GET /api/workspace/fs — directories only,
 * `~` expands) drives the selection; it asks without `path`, so it starts where
 * the server says: in the home directory of a workspace that has one, in the
 * process directory otherwise (2.1.58). The resolved path is also editable by
 * hand. Every refusal — ENOENT/EACCES and, in a workspace with a home,
 * `PROJECT_PATH_OUTSIDE_HOME` / `PROJECT_PATH_IS_HOME` — is shown inline in the
 * window with the server's message, never as a toast. On success the app does a full reload into
 * `/p/<id>/` because PROJECT_ID / API_BASE / router basepath are module-load
 * constants. Both endpoints are workspace-scope (raw fetch, no project prefix).
 *
 * 0.2.110 M31: the `project-create` modal kind (`openModal('project-create', {})`),
 * opened from the project switcher (project route) and the Welcome screen
 * (workspace route).
 */
export function ProjectCreate({ onClose: close }: ModalFormProps<'project-create'>) {
  const onClose = () => close(null);
  const [cwd, setCwd] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        | { projectId?: string; error?: { message?: string } }
        | null;
      if (!res.ok || !body?.projectId) {
        setError(body?.error?.message ?? `HTTP ${res.status}`);
        setPending(false);
        return;
      }
      toast.success('Project added to workspace');
      // Full reload into the new project — module-load constants must re-init.
      navigateDocument(`/p/${body.projectId}/`);
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
          {/* Server-side directory browser (shared with Settings dir fields). */}
          <DirectoryBrowser onCwdChange={setCwd} />

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
