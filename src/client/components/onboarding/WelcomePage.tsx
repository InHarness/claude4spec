import { useEffect, useState } from 'react';
import { FolderPlus, Folder } from 'lucide-react';
import { AddProjectDialog } from '../AddProjectDialog.js';
import { Skeleton } from '../../ui/Skeleton.js';

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
 * Decision #11 (0.1.57): `/welcome` runs the SPA project-less. 0.1.137: it is the
 * SOLE, unconditional target of the root `/` redirect (no more auto-jump to the
 * last-opened project) and, as before, the permanent target of the bare
 * `npx @inharness-ai/claude4spec`. Lists the workspace projects neutrally
 * (no highlight for the process CWD); picking one does a full reload to
 * `/p/<id>/` because PROJECT_ID / API_BASE / router basepath are module-load
 * constants. "Add project to workspace" reuses the switcher's AddProjectDialog.
 */
export function WelcomePage() {
  const [workspace, setWorkspace] = useState<WorkspaceResponse | null>(null);
  const [showAddProject, setShowAddProject] = useState(false);

  useEffect(() => {
    fetch('/api/workspace')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: WorkspaceResponse | null) => d && setWorkspace(d))
      .catch(() => {
        /* keep null — the page still offers "Add project" */
      });
  }, []);

  const projects = workspace?.projects ?? [];

  return (
    <div
      className="h-full w-full flex items-start justify-center overflow-y-auto"
      style={{ background: 'var(--c-bg)' }}
    >
      <div
        className="w-full max-w-[640px] my-12 mx-6 px-8 py-9 rounded-lg"
        style={{ background: 'var(--c-card)', border: '1px solid var(--c-hair)' }}
      >
        <header className="mb-6">
          <h1 className="text-[22px] font-semibold mb-1.5" style={{ color: 'var(--c-ink)' }}>
            Welcome to claude4spec
          </h1>
          <p className="text-[13px] leading-relaxed" style={{ color: 'var(--c-muted)' }}>
            {workspace ? (
              <>
                Open a project in workspace{' '}
                <code
                  className="mx-1 px-1 py-0.5 rounded text-[12px]"
                  style={{ background: 'var(--c-panel)' }}
                >
                  {workspace.name}
                </code>
                , or add a directory to the workspace.
              </>
            ) : (
              'Open a project, or add a directory to the workspace.'
            )}
          </p>
        </header>

        <div className="flex flex-col gap-1.5">
          {!workspace
            ? [0, 1, 2].map((i) => (
                <div
                  key={`sk-${i}`}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-md"
                  style={{ border: '1px solid var(--c-hair)' }}
                >
                  <span className="flex-1 min-w-0">
                    <Skeleton width="45%" height={12} />
                    <Skeleton width="70%" height={9} className="mt-1.5" />
                  </span>
                </div>
              ))
            : null}

          {workspace && projects.length === 0 ? (
            <div
              className="px-3 py-6 rounded-md text-center text-[12.5px]"
              style={{ border: '1px dashed var(--c-hair)', color: 'var(--c-subtle)' }}
            >
              No projects registered yet — add a directory below.
            </div>
          ) : null}

          {projects.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                // Full reload — module-load constants must re-initialize.
                window.location.href = `/p/${p.id}/`;
              }}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-left transition-colors"
              style={{ border: '1px solid var(--c-hair)', color: 'var(--c-ink)' }}
            >
              <Folder size={15} style={{ color: 'var(--c-accent)', flexShrink: 0 }} />
              <span className="flex-1 min-w-0">
                <span className="block text-[13px] font-medium truncate">{p.name}</span>
                <span
                  className="block text-[10.5px] font-mono truncate"
                  style={{ color: 'var(--c-subtle)', direction: 'rtl', textAlign: 'left' }}
                  title={p.cwd}
                >
                  {p.cwd}
                </span>
              </span>
            </button>
          ))}
        </div>

        <div className="mt-6">
          <button
            type="button"
            onClick={() => setShowAddProject(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-[13px] font-medium"
            style={{ background: 'var(--c-accent)', color: '#fff' }}
          >
            <FolderPlus size={14} /> Add project to workspace
          </button>
        </div>
      </div>

      {showAddProject ? <AddProjectDialog onClose={() => setShowAddProject(false)} /> : null}
    </div>
  );
}
