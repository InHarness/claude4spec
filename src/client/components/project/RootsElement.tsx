import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRenameRoot } from '../../hooks/useConfig.js';
import { ApiError } from '../../lib/api.js';
import { toast } from '../../ui/events.js';
import { DEFAULT_USER_ROOT_PROPS, type Root } from '../../../shared/types.js';
import { ElementField, Feedback, PathControl, inputStyle } from '../settings/controls.js';
import type { ElementContext, SettingsElementDecl } from '../settings/registry.js';
import { RESERVED_WRITE_TARGETS, isPathSafeRelative, rootOverlapsDir, rootsOverlap } from './dirOverlap.js';

const ROOTS = ['roots'] as const;

/** label → root id: lowercase, non-alphanumerics collapsed to '-', trimmed. */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Why a root's `dir` is refused before saving, or `null`: path safety, and a
 * collision with a directory the app WRITES to (another root, entitiesDir,
 * releasesDir, the plugin dir). An overlap with briefs/patches/plans is only a
 * warning on the server and is not raised here.
 */
function dirError(root: Root, roots: Root[], draft: ElementContext['draft']): string | null {
  if (!isPathSafeRelative(root.dir)) return 'Must be a relative path inside the project.';
  for (const other of roots) {
    if (other !== root && isPathSafeRelative(other.dir) && rootsOverlap(root.dir, other.dir)) {
      return `Overlaps the root '${other.id}'.`;
    }
  }
  for (const [label, dir] of [
    ['entitiesDir', String(draft.get(['entitiesDir']) ?? '')],
    ['releasesDir', String(draft.get(['releasesDir']) ?? '')],
    ...RESERVED_WRITE_TARGETS.map((d) => ['the plugin directory', d]),
  ] as const) {
    if (dir && rootOverlapsDir(root.dir, dir)) return `Overlaps ${label}.`;
  }
  return null;
}

/**
 * 0.2.113 — the Roots element of the Directories card (§6.2 / §6.3).
 *
 * Each row — the base root (`builtin`) included — edits two things: the label
 * (`name`) and the directory (`dir`, chosen with the `directory-browse` picker,
 * not typed). Neither ever changes `id`. The remaining fields of a root
 * (`releasable`, `sectionIndexed`, `referenceValidated`, `linkTargets`,
 * `sidebar`, `briefTarget`, `builtin`) have no controls: the row sends them back
 * unchanged, because a root record is complete or it is invalid.
 *
 * "Change root ID" is NOT part of the card's save: it is an action on its own
 * route, carrying the config's state token, and it holds the card's [Save] while
 * it runs.
 */
export function RootsElement({ config, draft }: ElementContext & { decl: SettingsElementDecl }) {
  const roots = (draft.get(ROOTS) ?? []) as Root[];
  const setRoots = (next: Root[]) => draft.set(ROOTS, next);
  const renameRoot = useRenameRoot();
  const qc = useQueryClient();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newDir, setNewDir] = useState('');
  const [addError, setAddError] = useState<{ name?: string; dir?: string }>({});
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);

  // Live validation: one error per row's dir, reported to the card so it blocks [Save]
  // — only once the roots are edited: an untouched `roots[]` is not sent, and a
  // collision it already carries must not hold a save of another field.
  const rootsEdited = draft.isDirty(ROOTS);
  const firstDirError = rootsEdited
    ? (roots.map((r) => dirError(r, roots, draft)).find((e) => e !== null) ?? null)
    : null;
  useEffect(() => {
    draft.setLiveError(ROOTS, firstDirError);
  }, [firstDirError, draft]);

  const updateRoot = (id: string, patch: Partial<Root>) =>
    setRoots(roots.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  function removeRoot(id: string) {
    setRoots(
      roots
        .filter((r) => r.id !== id)
        // Drop the removed id from every other root's link scope — a dangling
        // link target would be refused by the server.
        .map((r) => ({ ...r, linkTargets: r.linkTargets.filter((t) => t !== id) })),
    );
    setConfirmRemoveId(null);
  }

  function addRoot() {
    const name = newName.trim();
    const id = slugify(name);
    const errors: { name?: string; dir?: string } = {};
    if (!id) errors.name = 'Enter a label with at least one letter or digit.';
    else if (roots.some((r) => r.id === id)) errors.name = `A root with the id '${id}' already exists.`;
    const dir = newDir.trim() || id;
    const candidate: Root = {
      id,
      name,
      dir,
      builtin: false,
      ...DEFAULT_USER_ROOT_PROPS,
      linkTargets: [...DEFAULT_USER_ROOT_PROPS.linkTargets],
    };
    if (!errors.name) {
      const e = dirError(candidate, [...roots, candidate], draft);
      if (e) errors.dir = e;
    }
    setAddError(errors);
    if (errors.name || errors.dir) return;
    setRoots([...roots, candidate]);
    setNewName('');
    setNewDir('');
  }

  async function submitRename(rootId: string, newId: string) {
    setRenameError(null);
    draft.setBusy('Changing the root ID…');
    try {
      const result = await renameRoot.mutateAsync({
        rootId,
        newId: newId.trim(),
        expectedConfigHash: config.configHash,
      });
      // `alreadyApplied` — a lost response, a second click — is the target state,
      // not an error: the space already answers under the new identifier.
      toast.success(
        result.alreadyApplied
          ? `Root ID is already ${result.rootId}`
          : `Root ID changed to ${result.rootId}`,
      );
      setRenamingId(null);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CONFIG_CONFLICT') {
        // The file changed under us — show the roots as they are on disk now.
        await qc.invalidateQueries({ queryKey: ['config'] });
      }
      // ROOT_ID_TAKEN carries two different texts — taken by another root, or
      // retired by an earlier rename — and each is shown as the server wrote it.
      setRenameError(err instanceof ApiError ? err.message : 'Rename failed');
    } finally {
      draft.setBusy(null);
    }
  }

  const rootsDirty = rootsEdited;

  return (
    <div className="flex flex-col gap-3">
      <span className="text-[11.5px] font-medium uppercase tracking-wide" style={{ color: 'var(--c-muted)' }}>
        Roots
      </span>
      {roots.map((root) => {
        const saved = config.roots.some((r) => r.id === root.id);
        return (
          <div
            key={root.id}
            data-root-id={root.id}
            className="flex flex-col gap-3 rounded-md p-3"
            style={{ background: 'var(--c-bg)', border: '1px solid var(--c-hair)' }}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[13px] font-medium truncate" style={{ color: 'var(--c-ink)' }}>
                  {root.name || root.id}
                </span>
                <span className="text-[10.5px] font-mono" style={{ color: 'var(--c-subtle)' }}>
                  {root.id}
                </span>
                {root.builtin ? (
                  <span
                    className="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
                    style={{ background: 'var(--c-accent-soft)', color: 'var(--c-accent)' }}
                  >
                    built-in
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {renamingId !== root.id && saved ? (
                  <button
                    type="button"
                    onClick={() => {
                      setRenameError(null);
                      setRenamingId(root.id);
                    }}
                    disabled={rootsDirty || renameRoot.isPending || draft.saving}
                    title={rootsDirty ? 'Save or discard the changes to the roots first.' : undefined}
                    className="rounded px-2 py-1 text-[11.5px] font-medium disabled:opacity-50"
                    style={{ color: 'var(--c-accent)' }}
                  >
                    Change root ID
                  </button>
                ) : null}
                {!root.builtin && confirmRemoveId !== root.id ? (
                  <button
                    type="button"
                    onClick={() => setConfirmRemoveId(root.id)}
                    disabled={renameRoot.isPending || draft.saving}
                    className="rounded px-2 py-1 text-[11.5px] font-medium disabled:opacity-50"
                    style={{ color: '#b3261e' }}
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            </div>

            {confirmRemoveId === root.id ? (
              <div
                className="flex items-center justify-between gap-2 rounded-md px-3 py-2 text-[12px]"
                style={{ background: 'rgba(179, 38, 30, 0.08)', color: 'var(--c-ink)' }}
                data-testid="root-remove-confirm"
              >
                <span>Remove this root? Its files stay on disk.</span>
                <span className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setConfirmRemoveId(null)}
                    className="rounded px-2 py-1 text-[11.5px]"
                    style={{ color: 'var(--c-muted)' }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => removeRoot(root.id)}
                    className="rounded px-2 py-1 text-[11.5px] font-medium"
                    style={{ background: '#b3261e', color: '#fff' }}
                  >
                    Remove
                  </button>
                </span>
              </div>
            ) : null}

            {renamingId === root.id ? (
              <RenameForm
                sourceId={root.id}
                error={renameError}
                pending={renameRoot.isPending}
                onCancel={() => {
                  setRenameError(null);
                  setRenamingId(null);
                }}
                onSubmit={(newId) => void submitRename(root.id, newId)}
              />
            ) : null}

            <ElementField label="Name">
              <input
                type="text"
                value={root.name}
                onChange={(e) => updateRoot(root.id, { name: e.target.value })}
                disabled={draft.saving}
                className="w-full rounded-md px-3 py-1.5 text-[13px]"
                style={inputStyle}
              />
            </ElementField>
            <ElementField label="Directory" error={dirError(root, roots, draft)}>
              <PathControl
                value={root.dir}
                set={(v) => updateRoot(root.id, { dir: v })}
                disabled={draft.saving}
                label="Directory"
                readOnlyText
              />
            </ElementField>
          </div>
        );
      })}

      <div className="flex flex-col gap-3 rounded-md p-3" style={{ border: '1px dashed var(--c-hair)' }}>
        <ElementField label="Add page root — label" error={addError.name ?? null}>
          <input
            type="text"
            value={newName}
            onChange={(e) => {
              setNewName(e.target.value);
              if (addError.name) setAddError({});
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addRoot();
              }
            }}
            className="w-full rounded-md px-3 py-1.5 text-[13px]"
            style={inputStyle}
            placeholder="e.g. Guides"
          />
        </ElementField>
        <ElementField label="Directory (optional — defaults to the label's slug)" error={addError.dir ?? null}>
          <PathControl value={newDir} set={setNewDir} disabled={false} label="Directory" readOnlyText />
        </ElementField>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={addRoot}
            className="rounded-md px-3 py-1.5 text-[12px] font-medium"
            style={{ border: '1px solid var(--c-hair)', color: 'var(--c-ink)' }}
          >
            Add
          </button>
        </div>
      </div>
      <Feedback error={draft.error(ROOTS)} />
    </div>
  );
}

/**
 * "Change root ID" — the source identifier read-only, the target editable. The
 * refusal is shown AT the target field, never as a toast.
 */
function RenameForm({
  sourceId,
  error,
  pending,
  onCancel,
  onSubmit,
}: {
  sourceId: string;
  error: string | null;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (newId: string) => void;
}) {
  const [target, setTarget] = useState(sourceId);
  return (
    <div className="flex flex-col gap-1.5" data-testid="root-rename-form">
      <span className="text-[11.5px] font-medium uppercase tracking-wide" style={{ color: 'var(--c-muted)' }}>
        Change root ID
      </span>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={sourceId}
          readOnly
          aria-label="Current root ID"
          className="w-32 rounded-md px-3 py-1.5 text-[13px] font-mono"
          style={{ ...inputStyle, opacity: 0.7 }}
        />
        <span style={{ color: 'var(--c-muted)' }}>→</span>
        <input
          type="text"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          aria-label="New root ID"
          className="flex-1 rounded-md px-3 py-1.5 text-[13px] font-mono"
          style={{ ...inputStyle, border: `1px solid ${error ? '#b3261e' : 'var(--c-hair)'}` }}
          placeholder="kebab-case slug"
        />
        <button
          type="button"
          disabled={pending || target.trim() === '' || target.trim() === sourceId}
          onClick={() => onSubmit(target)}
          className="rounded-md px-3 py-1.5 text-[12px] font-medium disabled:opacity-50"
          style={{ background: 'var(--c-accent)', color: '#fff' }}
        >
          Change
        </button>
        <button type="button" onClick={onCancel} className="rounded-md px-2 py-1.5 text-[12px]" style={{ color: 'var(--c-muted)' }}>
          Cancel
        </button>
      </div>
      <span className="text-[11.5px]" style={{ color: 'var(--c-muted)' }}>
        Changes the address only — the directory, the pages and their version history stay. The previous identifier
        stays permanently reserved. Saved on its own, not by the card&apos;s [Save].
      </span>
      {error ? (
        <span className="text-[11.5px]" role="alert" style={{ color: '#b3261e' }}>
          {error}
        </span>
      ) : null}
    </div>
  );
}

