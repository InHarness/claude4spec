/**
 * DEBT (2.1.20, Host UI Kit slice of M17): the create-release window on
 * `releases-list` draws its own scrim and panel. It fails locality condition 2 —
 * a window shell does not follow from anything release-specific and repeats
 * with every form window. Its catalog replacement is `Dialog`.
 * Recorded, not fixed here.
 */
import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useCreateRelease, useUnreleasedCount } from '../hooks/useReleases.js';
import { ApiError } from '../lib/api-core.js';
import { surfaceGitSync } from '../ui/events.js';
import { MAX_RELEASE_DESCRIPTION_LENGTH, releaseDescriptionLength } from '../../shared/entities.js';

interface Props {
  onClose: () => void;
}

export function CreateReleaseDialog({ onClose }: Props) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Code points after trim — the server's own measure (0.2.112).
  const descriptionLength = releaseDescriptionLength(description);
  const tooLongMessage = `Description must be at most ${MAX_RELEASE_DESCRIPTION_LENGTH} characters — keep it a short statement of intent`;
  const navigate = useNavigate();
  const create = useCreateRelease();
  // 2.1.45 (M17 d8871ce9 / hybasevj): an empty release — the shared unreleased
  // counter equal to 0 — is allowed; the window only warns and never blocks.
  // Without any release the counter does not exist (`undefined`): no warning.
  // The window opens over `/releases`, which already holds the counter: read
  // it, do not refetch it on open.
  const { data: unreleasedCount } = useUnreleasedCount({ refetchOnMount: false });
  const emptyRelease = unreleasedCount === 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    if (!description.trim()) {
      setError('Description is required');
      return;
    }
    if (descriptionLength > MAX_RELEASE_DESCRIPTION_LENGTH) {
      setError(tooLongMessage);
      return;
    }
    try {
      const release = await create.mutateAsync({
        name: name.trim(),
        description: description.trim(),
      });
      // M28: git commit-sync is best-effort — a failure never blocks creation.
      // 2.1.14: only `status: 'error'` reacts (the `git-sync-recover` window);
      // every other result, `null` included, gives no signal.
      // 2.1.55 (M17 m17ui001, M28 u5vl07ch): the same for `gitPush`, the push
      // that follows the release commit. Both never err together: the push runs
      // only after a `committed` gitSync.
      surfaceGitSync(release.gitSync);
      surfaceGitSync(release.gitPush);
      onClose();
      navigate({ to: '/releases/$name', params: { name: release.name } });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'RELEASE_NAME_CONFLICT') {
          setError(`Name '${name}' is already taken`);
          return;
        }
        if (err.code === 'RELEASE_SLUG_CONFLICT') {
          setError(`Name '${name}' resolves to the same identifier as an existing release — choose a more distinct name`);
          return;
        }
        if (err.code === 'RELEASE_DESCRIPTION_REQUIRED') {
          setError('Description is required');
          return;
        }
        if (err.code === 'RELEASE_DESCRIPTION_TOO_LONG') {
          setError(tooLongMessage);
          return;
        }
        setError(err.message);
        return;
      }
      setError((err as Error).message);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="rounded-lg flex flex-col"
        style={{
          width: 480,
          background: 'var(--c-bg)',
          border: '1px solid var(--c-hair-strong)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
        }}
      >
        <div
          className="px-5 py-3"
          style={{ borderBottom: '1px solid var(--c-hair)' }}
        >
          <div className="text-[14px] font-semibold" style={{ color: 'var(--c-ink)' }}>
            Create release
          </div>
          <div className="text-[11.5px] mt-0.5" style={{ color: 'var(--c-subtle)' }}>
            Snapshots all unreleased entity and page changes under a named tag.
          </div>
        </div>

        <div className="px-5 py-4 space-y-3">
          {emptyRelease && (
            <div
              role="status"
              data-testid="create-release-empty-warning"
              className="text-[12px] rounded-md px-2.5 py-1.5"
              style={{ background: 'var(--c-accent-soft)', color: 'var(--c-accent-ink)' }}
            >
              No changes since last release
            </div>
          )}
          <label className="block">
            <span
              className="block text-[11px] uppercase tracking-wider font-mono font-semibold mb-1"
              style={{ color: 'var(--c-subtle)' }}
            >
              Name
            </span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="v1.0.0"
              className="w-full rounded-md px-2.5 py-1.5 text-[13px] outline-none"
              style={{
                background: 'var(--c-card)',
                border: '1px solid var(--c-hair)',
                color: 'var(--c-ink)',
              }}
            />
          </label>

          <label className="block">
            <span
              className="block text-[11px] uppercase tracking-wider font-mono font-semibold mb-1"
              style={{ color: 'var(--c-subtle)' }}
            >
              Description (required)
            </span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this release capture? Why are you tagging it?"
              rows={3}
              className="w-full rounded-md px-2.5 py-1.5 text-[13px] outline-none resize-y"
              style={{
                background: 'var(--c-card)',
                border: '1px solid var(--c-hair)',
                color: 'var(--c-ink)',
              }}
            />
            <span
              className="block text-right text-[11px] font-mono mt-0.5"
              style={{ color: descriptionLength > MAX_RELEASE_DESCRIPTION_LENGTH ? '#dc2626' : 'var(--c-subtle)' }}
              data-testid="release-description-counter"
            >
              {descriptionLength} / {MAX_RELEASE_DESCRIPTION_LENGTH}
            </span>
          </label>

          {error && (
            <div
              className="text-[12px] rounded-md px-2.5 py-1.5"
              style={{ background: 'rgba(220,38,38,0.08)', color: '#dc2626' }}
            >
              {error}
            </div>
          )}
        </div>

        <div
          className="flex items-center justify-end gap-2 px-5 py-3"
          style={{ borderTop: '1px solid var(--c-hair)' }}
        >
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1 text-[12.5px]"
            style={{ background: 'var(--c-card)', color: 'var(--c-muted)', border: '1px solid var(--c-hair)' }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={create.isPending}
            className="rounded-md px-3 py-1 text-[12.5px]"
            style={{
              background: 'var(--c-accent)',
              color: '#fff',
              opacity: create.isPending ? 0.6 : 1,
            }}
          >
            {create.isPending ? 'Creating…' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  );
}
