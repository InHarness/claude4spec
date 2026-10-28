import { FolderPlus, Folder } from 'lucide-react';
import { openModal } from '../../ui/events.js';
import { Skeleton } from '../../ui/Skeleton.js';
import { useWorkspace } from '../../hooks/useWorkspace.js';
import { navigateDocument } from '../../lib/document-nav.js';

/**
 * M31 ui-view `welcome-page` (`/welcome`) — a WORKSPACE ROUTE (2.1.58): mounted
 * outside the project prefix, in the workspace route frame (M50 `1bd92aq2`),
 * which also carries the bar with the branding and the workspace header entry;
 * the screen itself is only the registry listing. Its document has no
 * `window.__C4S_PROJECT__` by construction.
 *
 * Lists the workspace projects neutrally (no highlight for the directory the
 * process was started in); picking one does a full load of `/p/<id>/`, because
 * PROJECT_ID / API_BASE / the router basepath are module-load constants. "Add
 * project to workspace" opens the `project-create` window.
 */
export function WelcomePage() {
  const { data: workspace } = useWorkspace();

  const projects = workspace?.projects ?? [];

  return (
    <div
      className="flex-1 min-h-0 w-full flex items-start justify-center overflow-y-auto"
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
                navigateDocument(`/p/${p.id}/`);
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
            onClick={() => void openModal('project-create', {})}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-[13px] font-medium"
            style={{ background: 'var(--c-accent)', color: '#fff' }}
          >
            <FolderPlus size={14} /> Add project to workspace
          </button>
        </div>
      </div>

    </div>
  );
}
