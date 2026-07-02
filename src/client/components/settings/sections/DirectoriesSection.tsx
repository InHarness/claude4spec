import { useEffect, useMemo, useState } from 'react';
import { useConfig, usePatchConfig } from '../../../hooks/useConfig.js';
import { ApiError, type ConfigPatch } from '../../../lib/api.js';
import { toast } from '../../../ui/events.js';
import { type Root, DEFAULT_USER_ROOT_PROPS } from '../../../../shared/types.js';
import { SettingsCard } from '../SettingsCard.js';
import { DirectoryPickerModal } from '../../../host-ui-kit/overlay/DirectoryPickerModal.js';

interface DraftState {
  roots: Root[];
  briefsDir: string;
  patchesDir: string;
  entitiesDir: string;
}

/**
 * 0.1.96: mirror of the server's write/read targets a root's `dir` must never
 * overlap (see `RESERVED_WRITE_TARGETS` in src/server/config.ts). Kept as a local
 * const so the client never pulls node-only server config code into the bundle;
 * the server re-validates authoritatively on PATCH.
 */
const RESERVED_WRITE_TARGETS = ['.claude4spec/skills', '.claude4spec/plugins'];

function buildDraft(config: ReturnType<typeof useConfig>['data']): DraftState {
  return {
    roots: (config?.roots ?? []).map((r) => ({ ...r, linkTargets: [...r.linkTargets] })),
    briefsDir: config?.briefsDir ?? '',
    patchesDir: config?.patchesDir ?? '',
    entitiesDir: config?.entitiesDir ?? '',
  };
}

/** name → root id/dir slug: lowercase, non-alphanumerics collapsed to '-', trimmed. */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Normalize a cwd-relative dir for overlap comparison (mirror of server normDir). */
function normDir(dir: string): string {
  let n = dir.trim().replace(/\\+/g, '/').replace(/\/+$/, '');
  n = n.replace(/^\.\//, '');
  return n === '.' || n === '' ? '' : n;
}

/** True when `child` equals or is nested under `parent` (both normalized, '/'-sep). */
function isInsideDir(parent: string, child: string): boolean {
  if (parent === child) return true;
  if (parent === '') return true; // cwd root contains everything
  return child.startsWith(parent + '/');
}

/** True when any '/'-segment of a relative path starts with '.' (dot-dir the walker skips). */
function hasDotSegment(rel: string): boolean {
  return rel.split('/').some((s) => s.startsWith('.'));
}

/**
 * Dot-directory-aware overlap (mirror of server config.ts `dirsOverlap`). A page
 * root at '.' contains `.claude4spec/*` but the pages walker skips dot-dirs, so
 * that is NOT a conflict — only flag when the walker would actually reach the
 * other dir, or when the root is nested inside it.
 */
function dirsOverlap(rootDir: string, otherDir: string): boolean {
  const na = normDir(rootDir);
  const nb = normDir(otherDir);
  if (na === nb) return true;
  if (isInsideDir(nb, na)) return true; // root nested under other
  if (isInsideDir(na, nb)) {
    const rel = na === '' ? nb : nb.slice(na.length + 1);
    return !hasDotSegment(rel);
  }
  return false;
}

/** A cwd-relative dir must be non-empty, not absolute, and not escape cwd via `..`. */
function isPathSafeRelative(dir: string): boolean {
  const v = dir.trim();
  if (v === '') return false;
  if (/^([A-Za-z]:[\\/]|[\\/])/.test(v)) return false;
  const norm = v.replace(/\\/g, '/');
  if (norm === '..' || norm.startsWith('../') || norm.includes('/../')) return false;
  return true;
}

/**
 * Client-side echo of `validateRootDirs` (src/server/config.ts). Hard errors block
 * Save (the server would 400 anyway); warnings are informational (overlap with
 * briefs/patches). The server re-validates on PATCH.
 */
function validateDraft(draft: DraftState): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const { roots } = draft;

  const seen = new Set<string>();
  for (const r of roots) {
    if (!r.id.trim()) errors.push(`A root has an empty id`);
    else if (seen.has(r.id)) errors.push(`Duplicate root id '${r.id}'`);
    seen.add(r.id);
    if (!isPathSafeRelative(r.dir)) {
      errors.push(`Root '${r.id}' dir must be a relative path inside the project`);
    }
  }

  const hardTargets: Array<{ id: string; dir: string }> = [
    { id: 'entitiesDir', dir: draft.entitiesDir },
    ...RESERVED_WRITE_TARGETS.map((d) => ({ id: d, dir: d })),
  ];
  for (let i = 0; i < roots.length; i++) {
    const r = roots[i]!;
    for (let j = i + 1; j < roots.length; j++) {
      const other = roots[j]!;
      if (dirsOverlap(r.dir, other.dir)) {
        errors.push(`Root '${r.id}' dir overlaps root '${other.id}'`);
      }
    }
    for (const t of hardTargets) {
      if (dirsOverlap(r.dir, t.dir)) {
        errors.push(`Root '${r.id}' dir overlaps write-target '${t.id}'`);
      }
    }
    if (dirsOverlap(r.dir, draft.briefsDir)) {
      warnings.push(`Root '${r.id}' dir overlaps briefsDir — pages may appear in both`);
    }
    if (dirsOverlap(r.dir, draft.patchesDir)) {
      warnings.push(`Root '${r.id}' dir overlaps patchesDir — pages may appear in both`);
    }
  }
  return { errors, warnings };
}

/**
 * M26 (0.1.96 multiroot): project directory layout. The built-in `pages` root's
 * dir is editable but the root itself cannot be deleted; user roots support full
 * CRUD with per-root behaviour gates. Briefs/patches/entities stay as scalar path
 * inputs. A successful PATCH { roots } rebuilds the project context server-side —
 * no restart, no banner (the `onContextConfigChanged` path handles it).
 */
export function DirectoriesSection() {
  const { data: config } = useConfig();
  const patch = usePatchConfig();
  const [draft, setDraft] = useState<DraftState>(() => buildDraft(config));
  const [newRootName, setNewRootName] = useState('');
  const [newRootDir, setNewRootDir] = useState('');

  useEffect(() => {
    setDraft(buildDraft(config));
  }, [config]);

  const { errors, warnings } = useMemo(() => validateDraft(draft), [draft]);

  const dirty = useMemo(() => {
    if (!config) return false;
    return JSON.stringify(draft) !== JSON.stringify(buildDraft(config));
  }, [draft, config]);

  function updateRoot(id: string, patchRoot: Partial<Root>) {
    setDraft((d) => ({
      ...d,
      roots: d.roots.map((r) => (r.id === id ? { ...r, ...patchRoot } : r)),
    }));
  }

  function removeRoot(id: string) {
    setDraft((d) => ({
      ...d,
      roots: d.roots
        .filter((r) => r.id !== id)
        // Drop the removed id from every other root's link scope so we never send
        // a dangling link target (the server would 400).
        .map((r) => ({ ...r, linkTargets: r.linkTargets.filter((t) => t !== id) })),
    }));
  }

  function addRoot() {
    const name = newRootName.trim();
    const id = slugify(name);
    if (!id) {
      toast.error('Enter a name (letters/numbers) for the new root');
      return;
    }
    if (draft.roots.some((r) => r.id === id)) {
      toast.error(`A root with id '${id}' already exists`);
      return;
    }
    const root: Root = {
      id,
      name,
      // Use the browsed/typed directory when provided, else derive it from the slug.
      dir: newRootDir.trim() || id,
      builtin: false,
      ...DEFAULT_USER_ROOT_PROPS,
      linkTargets: [...DEFAULT_USER_ROOT_PROPS.linkTargets],
    };
    setDraft((d) => ({ ...d, roots: [...d.roots, root] }));
    setNewRootName('');
    setNewRootDir('');
  }

  async function handleSave() {
    if (!config || errors.length > 0) return;
    const patchBody: ConfigPatch = {};
    if (JSON.stringify(draft.roots) !== JSON.stringify(config.roots)) {
      patchBody.roots = draft.roots;
    }
    if (draft.briefsDir !== config.briefsDir) patchBody.briefsDir = draft.briefsDir;
    if (draft.patchesDir !== config.patchesDir) patchBody.patchesDir = draft.patchesDir;
    if (draft.entitiesDir !== config.entitiesDir) patchBody.entitiesDir = draft.entitiesDir;
    if (Object.keys(patchBody).length === 0) return;
    try {
      await patch.mutateAsync(patchBody);
      toast.success('Directories saved');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Save failed');
    }
  }

  return (
    <SettingsCard
      id="directories"
      title="Directories"
      description="Page roots and project directory layout — applied immediately (the project context rebuilds on the next request)."
      badge="hot-reload"
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3">
          {draft.roots.map((root) => (
            <RootCard
              key={root.id}
              root={root}
              onChange={(p) => updateRoot(root.id, p)}
              onRemove={root.builtin ? undefined : () => removeRoot(root.id)}
            />
          ))}
        </div>

        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span
              className="text-[11.5px] font-medium uppercase tracking-wide"
              style={{ color: 'var(--c-muted)' }}
            >
              Add page root
            </span>
            <input
              type="text"
              value={newRootName}
              onChange={(e) => setNewRootName(e.target.value)}
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
          </label>
          <DirField
            label="Directory (optional — defaults to name)"
            value={newRootDir}
            onChange={setNewRootDir}
          />
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

        <div className="flex flex-col gap-4 pt-3" style={{ borderTop: '1px solid var(--c-hair)' }}>
          <DirField
            label="Briefs directory"
            value={draft.briefsDir}
            onChange={(v) => setDraft((d) => ({ ...d, briefsDir: v }))}
          />
          <DirField
            label="Patches directory"
            value={draft.patchesDir}
            onChange={(v) => setDraft((d) => ({ ...d, patchesDir: v }))}
          />
          <DirField
            label="Entities directory"
            value={draft.entitiesDir}
            onChange={(v) => setDraft((d) => ({ ...d, entitiesDir: v }))}
          />
        </div>

        {errors.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {errors.map((e, i) => (
              <li key={i} className="text-[11.5px]" style={{ color: '#b3261e' }}>
                {e}
              </li>
            ))}
          </ul>
        ) : null}
        {warnings.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {warnings.map((w, i) => (
              <li key={i} className="text-[11.5px]" style={{ color: '#a87033' }}>
                {w}
              </li>
            ))}
          </ul>
        ) : null}

        <div className="flex justify-end">
          <button
            type="button"
            disabled={!dirty || errors.length > 0 || patch.isPending}
            onClick={handleSave}
            className="rounded-md px-3 py-1.5 text-[12px] font-medium disabled:opacity-50"
            style={{ background: 'var(--c-accent)', color: '#fff' }}
          >
            Save
          </button>
        </div>
      </div>
    </SettingsCard>
  );
}

/**
 * 0.1.97: a page root is "just another page directory sharing the `pages`
 * lifecycle", so the card exposes only Name + Directory. The behaviour gates
 * (`releasable`/`sectionIndexed`/`referenceValidated`/`briefTarget`/`sidebar`/
 * `linkTargets`) still ride along on each `Root` in `draft.roots` → PATCH; they
 * are simply no longer user-editable here.
 */
function RootCard({
  root,
  onChange,
  onRemove,
}: {
  root: Root;
  onChange: (patch: Partial<Root>) => void;
  onRemove?: () => void;
}) {
  return (
    <div
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
        {onRemove ? (
          <button
            type="button"
            onClick={onRemove}
            className="shrink-0 rounded px-2 py-1 text-[11.5px] font-medium"
            style={{ color: '#b3261e' }}
          >
            Remove
          </button>
        ) : null}
      </div>

      {!root.builtin ? (
        <TextField
          label="Name"
          value={root.name}
          onChange={(v) => onChange({ name: v })}
        />
      ) : null}

      <DirField label="Directory" value={root.dir} onChange={(v) => onChange({ dir: v })} />
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <Field label={label}>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md px-3 py-1.5 text-[13px]"
        style={inputStyle}
      />
    </Field>
  );
}

/**
 * A cwd-relative directory input. Manual typing always works; the "Browse…"
 * affordance opens the shared `DirectoryPickerModal` in relative mode, which
 * converts the chosen absolute path back to a project-cwd-relative string (and
 * rejects a selection outside the project). Serves every dir field here — each
 * root's Directory plus briefs/patches/entities.
 */
function DirField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  return (
    <>
      <Field label={label}>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-full rounded-md px-3 py-1.5 text-[13px] font-mono"
            style={inputStyle}
            placeholder="relative to project root"
          />
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="shrink-0 rounded-md px-3 py-1.5 text-[12px] font-medium"
            style={{ border: '1px solid var(--c-hair)', color: 'var(--c-ink)' }}
          >
            Browse…
          </button>
        </div>
      </Field>
      <DirectoryPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        mode="relative"
        onSelect={onChange}
        title={`Choose ${label.toLowerCase()}`}
      />
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11.5px] font-medium uppercase tracking-wide" style={{ color: 'var(--c-muted)' }}>
        {label}
      </span>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  background: 'var(--c-bg)',
  border: '1px solid var(--c-hair)',
  color: 'var(--c-ink)',
};
