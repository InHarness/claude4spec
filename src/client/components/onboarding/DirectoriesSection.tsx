export interface DirectoriesDraft {
  pagesDir: string;
  briefsDir: string;
  patchesDir: string;
  entitiesDir: string;
}

/**
 * 0.1.56: optional "Advanced / Directories" block in onboarding. Collapsed by
 * default (`<details>`), four controlled inputs pre-filled from GET /api/config.
 * It does NOT gate [Continue] and has no client-side validation — path-safety is
 * enforced server-side (M01), a 400 surfaces via the page's toast.error.
 */
export function DirectoriesSection({
  draft,
  onChange,
}: {
  draft: DirectoriesDraft;
  onChange: (next: Partial<DirectoriesDraft>) => void;
}) {
  return (
    <details
      className="mt-5 mb-2 rounded-lg"
      style={{ border: '1px solid var(--c-hair)', background: 'var(--c-bg)' }}
    >
      <summary
        className="cursor-pointer select-none px-4 py-3 text-[13px] font-medium"
        style={{ color: 'var(--c-ink)' }}
      >
        Advanced / Directories
        <span className="ml-2 text-[12px] font-normal" style={{ color: 'var(--c-muted)' }}>
          — optional, defaults are fine
        </span>
      </summary>
      <div className="flex flex-col gap-4 px-4 pb-4 pt-1">
        <DirField
          label="Pages directory"
          value={draft.pagesDir}
          onChange={(v) => onChange({ pagesDir: v })}
        />
        <DirField
          label="Briefs directory"
          value={draft.briefsDir}
          onChange={(v) => onChange({ briefsDir: v })}
        />
        <DirField
          label="Patches directory"
          value={draft.patchesDir}
          onChange={(v) => onChange({ patchesDir: v })}
        />
        <DirField
          label="Entities directory"
          value={draft.entitiesDir}
          onChange={(v) => onChange({ entitiesDir: v })}
        />
      </div>
    </details>
  );
}

function DirField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span
        className="text-[11.5px] font-medium uppercase tracking-wide"
        style={{ color: 'var(--c-muted)' }}
      >
        {label}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md px-3 py-1.5 text-[13px] font-mono"
        style={{
          background: 'var(--c-card)',
          border: '1px solid var(--c-hair)',
          color: 'var(--c-ink)',
        }}
        placeholder="relative to project root"
      />
    </label>
  );
}
