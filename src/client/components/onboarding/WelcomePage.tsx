import { FolderPlus, Folder } from 'lucide-react';
import { Skeleton } from '../../ui/Skeleton.js';
import { useWorkspace } from '../../hooks/useWorkspace.js';
import { useProjectTypes } from '../../hooks/useProjectTypes.js';
import { navigateDocument } from '../../lib/document-nav.js';
import { groupByType } from '../../lib/group-by-type.js';
import type { WorkspaceProject } from '../../lib/workspace.js';

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
 * project to workspace" navigates to the create-project page (`/create-project`,
 * ui-view `create-project-page`).
 *
 * 2.1.77 (M31 `gofah0an`, Odczyt typu projektu — the one place the module reads
 * the project type): each row shows the name of its type from the type
 * registry; a type the current version does not know makes the row unavailable,
 * its slug written out as is, and a click on it does not navigate.
 *
 * 2.1.86 (M31): the list is split into type groups ({@link groupByType}) — the
 * group from the type copy in the project record, the order and the headers
 * from `GET /api/workspace/project-types`, no empty group; an unknown slug is a
 * group of its own after the known ones, headed by the slug. Until the type
 * list is in, the list shows its skeleton; if it cannot be read, the rows stay
 * ungrouped.
 */
export function WelcomePage() {
  const { data: workspace } = useWorkspace();
  const { data: types, isError: typesFailed } = useProjectTypes();

  const projects = workspace?.projects ?? [];
  const ready = !!workspace && (!!types || typesFailed);
  const groups: Array<{ key: string; header: string | null; projects: WorkspaceProject[] }> = !types
    ? [{ key: 'all', header: null, projects }]
    : (() => {
        const g = groupByType(projects, (p) => p.projectType, types);
        return [
          ...g.known.map((k) => ({ key: k.slug, header: k.name, projects: k.items })),
          ...g.unknown.map((u) => ({ key: u.slug, header: u.slug, projects: u.items })),
          ...(g.untyped.length > 0 ? [{ key: 'untyped', header: null, projects: g.untyped }] : []),
        ];
      })();

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
          {!ready
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

          {ready && projects.length === 0 ? (
            <div
              className="px-3 py-6 rounded-md text-center text-[12.5px]"
              style={{ border: '1px dashed var(--c-hair)', color: 'var(--c-subtle)' }}
            >
              No projects registered yet — add a directory below.
            </div>
          ) : null}

          {ready
            ? groups.map((group) => (
                <div key={group.key} className="flex flex-col gap-1.5" data-project-type-group={group.key}>
                  {group.header !== null ? (
                    <div
                      data-testid="project-type-group-header"
                      className="px-1 pt-2 text-[10.5px] font-medium uppercase tracking-wide"
                      style={{ color: 'var(--c-subtle)' }}
                    >
                      {group.header}
                    </div>
                  ) : null}
                  {group.projects.map((p) => (
                    <WelcomeProjectRow key={p.id} project={p} />
                  ))}
                </div>
              ))
            : null}
        </div>

        <div className="mt-6">
          <button
            type="button"
            onClick={() => navigateDocument('/create-project')}
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

/** One project row of the registry: a known type loads the project's route, an unknown one is unavailable. */
function WelcomeProjectRow({ project: p }: { project: WorkspaceProject }) {
  const known = p.projectTypeName != null;
  return (
    <button
      type="button"
      disabled={!known}
      aria-disabled={!known}
      data-project-type={p.projectType}
      onClick={() => {
        if (!known) return;
        // Full reload — module-load constants must re-initialize.
        navigateDocument(`/p/${p.id}/`);
      }}
      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-left transition-colors disabled:cursor-not-allowed"
      style={{
        border: '1px solid var(--c-hair)',
        color: known ? 'var(--c-ink)' : 'var(--c-subtle)',
      }}
      title={known ? undefined : `Unknown project type: ${p.projectType}`}
    >
      <Folder size={15} style={{ color: known ? 'var(--c-accent)' : 'var(--c-subtle)', flexShrink: 0 }} />
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
      <span
        data-testid="project-type"
        className={`shrink-0 text-[11px] px-1.5 py-0.5 rounded${known ? '' : ' font-mono'}`}
        style={{ background: 'var(--c-panel)', color: 'var(--c-muted)' }}
      >
        {known ? p.projectTypeName : p.projectType}
      </span>
    </button>
  );
}
