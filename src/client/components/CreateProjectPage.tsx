import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { navigateDocument } from '../lib/document-nav.js';
import { SegmentedControlTabs } from '../host-ui-kit/detail/SegmentedControlTabs.js';
import { LoadingState } from '../host-ui-kit/actions/LoadingState.js';
import { DirectoryList } from './DirectoryList.js';
import type { AddProjectRequest, AddProjectResponse } from '../../shared/project-types.js';
import { useProjectTypes } from '../hooks/useProjectTypes.js';

/**
 * M31 ui-view `create-project-page` (`/create-project`, 2.1.77) — a WORKSPACE
 * route: mounted outside the project prefix, in the workspace route frame (M50
 * `1bd92aq2`), not fullscreen. Reached from "Add project to workspace" on the
 * Welcome screen and from the same action in the project switcher (a document
 * reload from a project route). It replaces the `project-create` window.
 *
 * Two paths, chosen by a switch above the body:
 * - `New project` (default): step 1 — the type cards of
 *   `GET /api/workspace/project-types`, in registry order, a choice required;
 *   step 2 — the directory list. `Create project` sends
 *   `POST /api/workspace/projects` with the directory and the chosen slug.
 * - `Add existing directory`: the directory list only. `Add project` sends the
 *   directory alone; the type comes from the directory's `config.json`.
 *
 * On success the page loads `/p/<projectId>/` (a document reload — the
 * project's module-load constants must initialise); a fresh project ends on
 * onboarding (the onboarding route's `redirectIf`). The page does not branch on
 * the type: it lists the registry, so a new type shows up without a change here.
 *
 * States: `types-loading`, `types-error` (New project shows an error with a
 * retry, Add existing directory keeps working), `directory-error` (inline under
 * the list, the type choice kept), `wrong-path` (the registration refused the
 * directory for the chosen path — a switch to the other path, the directory
 * kept selected), `submitting`.
 */

export type CreateProjectPath = 'new' | 'existing';

export { PROJECT_TYPES_QUERY_KEY } from '../hooks/useProjectTypes.js';

const PATH_TABS = [
  { id: 'new', label: 'New project' },
  { id: 'existing', label: 'Add existing directory' },
];

/** The refusal of a directory that does not fit the chosen path → the other path. */
const WRONG_PATH: Record<string, { message: string; switchTo: CreateProjectPath; action: string }> = {
  PROJECT_PATH_ALREADY_INITIALIZED: {
    message: 'This directory is already a project. Add it as an existing directory.',
    switchTo: 'existing',
    action: 'Add existing directory',
  },
  PROJECT_PATH_NOT_INITIALIZED: {
    message: 'This directory is not a project yet. Create a new project in it.',
    switchTo: 'new',
    action: 'New project',
  },
};

export function CreateProjectPage() {
  const [path, setPath] = useState<CreateProjectPath>('new');
  const [projectType, setProjectType] = useState<string | null>(null);
  const [cwd, setCwd] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  const [wrongPath, setWrongPath] = useState<string | null>(null);

  const types = useProjectTypes();

  const isNew = path === 'new';
  const canSubmit = !submitting && cwd.trim() !== '' && (!isNew || projectType != null);

  function choosePath(next: CreateProjectPath) {
    if (submitting) return;
    setPath(next);
    // The directory stays selected; only the refusal of the other path goes.
    setWrongPath(null);
    setDirectoryError(null);
  }

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setDirectoryError(null);
    setWrongPath(null);
    const body: AddProjectRequest = isNew ? { cwd: cwd.trim(), projectType: projectType! } : { cwd: cwd.trim() };
    try {
      const res = await fetch('/api/workspace/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const answer = (await res.json().catch(() => null)) as
        | (Partial<AddProjectResponse> & { error?: { code?: string; message?: string } })
        | null;
      if (!res.ok || !answer?.projectId) {
        const code = answer?.error?.code;
        if (code && WRONG_PATH[code]) setWrongPath(code);
        else setDirectoryError(answer?.error?.message ?? `HTTP ${res.status}`);
        setSubmitting(false);
        return;
      }
      // Full reload into the new project — module-load constants must re-init.
      navigateDocument(`/p/${answer.projectId}/`);
    } catch {
      setDirectoryError('Request failed — is the server still running?');
      setSubmitting(false);
    }
  }

  const wrong = wrongPath ? WRONG_PATH[wrongPath]! : null;

  return (
    <div
      className="flex-1 min-h-0 w-full flex items-start justify-center overflow-y-auto"
      style={{ background: 'var(--c-bg)' }}
    >
      <div
        className="w-full max-w-[640px] my-12 mx-6 px-8 py-9 rounded-lg"
        style={{ background: 'var(--c-card)', border: '1px solid var(--c-hair)' }}
      >
        <header className="mb-5">
          <h1 className="text-[22px] font-semibold mb-3" style={{ color: 'var(--c-ink)' }}>
            Create project
          </h1>
          <SegmentedControlTabs tabs={PATH_TABS} active={path} onChange={(id) => choosePath(id as CreateProjectPath)} />
        </header>

        {/* Step 1 of New project; `null` keeps the directory list in place across paths. */}
        {isNew ? (
          <section className="mb-5" data-testid="project-type-step">
            <h2 className="text-[11.5px] font-medium uppercase tracking-wide mb-2" style={{ color: 'var(--c-muted)' }}>
              Project type
            </h2>
            {types.isPending ? (
              <div data-testid="types-loading" aria-busy="true">
                <LoadingState lines={3} height={44} />
              </div>
            ) : types.isError ? (
              <div
                data-testid="types-error"
                role="alert"
                className="flex items-center gap-3 rounded-md px-3 py-2.5 text-[12.5px]"
                style={{ background: 'rgba(220,38,38,0.08)', color: '#dc2626' }}
              >
                <span className="flex-1">Could not load project types.</span>
                <button
                  type="button"
                  onClick={() => void types.refetch()}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11.5px] font-medium"
                  style={{ border: '1px solid currentColor' }}
                >
                  <RefreshCw size={11} /> Retry
                </button>
              </div>
            ) : (
              <div role="radiogroup" aria-label="Project type" className="grid gap-2">
                {types.data.map((t) => {
                  const chosen = t.slug === projectType;
                  return (
                    <button
                      key={t.slug}
                      type="button"
                      role="radio"
                      aria-checked={chosen}
                      data-slug={t.slug}
                      disabled={submitting}
                      onClick={() => setProjectType(t.slug)}
                      className="w-full text-left rounded-md px-3 py-2.5 disabled:opacity-60"
                      style={{
                        border: `1px solid ${chosen ? 'var(--c-accent)' : 'var(--c-hair)'}`,
                        background: chosen ? 'var(--c-panel)' : 'transparent',
                        color: 'var(--c-ink)',
                      }}
                    >
                      <span className="block text-[13px] font-medium">{t.name}</span>
                      <span className="block text-[12px] mt-0.5" style={{ color: 'var(--c-muted)' }}>
                        {t.description}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        ) : null}

        <section data-testid="directory-step">
          <h2 className="text-[11.5px] font-medium uppercase tracking-wide mb-2" style={{ color: 'var(--c-muted)' }}>
            {isNew ? 'Directory' : 'Existing directory'}
          </h2>
          <DirectoryList
            onCwdChange={(p) => {
              setCwd(p);
              setDirectoryError(null);
              setWrongPath(null);
            }}
            error={directoryError}
            disabled={submitting}
          />
          {wrong ? (
            <div
              data-testid="wrong-path"
              role="alert"
              className="mt-1.5 flex items-center gap-3 rounded-md px-2.5 py-1.5 text-[12px]"
              style={{ background: 'var(--c-panel)', color: 'var(--c-ink)', border: '1px solid var(--c-hair)' }}
            >
              <span className="flex-1">{wrong.message}</span>
              <button
                type="button"
                onClick={() => choosePath(wrong.switchTo)}
                className="px-2.5 py-1 rounded-md text-[11.5px] font-medium"
                style={{ background: 'var(--c-accent)', color: '#fff' }}
              >
                {wrong.action}
              </button>
            </div>
          ) : null}
        </section>

        <div className="mt-6 flex items-center gap-2">
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!canSubmit}
            aria-busy={submitting}
            className="px-4 py-2 rounded-md text-[13px] font-medium disabled:opacity-50"
            style={{ background: 'var(--c-accent)', color: '#fff' }}
          >
            {isNew ? (submitting ? 'Creating…' : 'Create project') : submitting ? 'Adding…' : 'Add project'}
          </button>
        </div>
      </div>
    </div>
  );
}
