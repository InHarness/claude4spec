/**
 * 0.1.96: onboarding no longer edits every scalar dir — the full roots[] editor
 * lives in Settings (M26). Onboarding keeps a single optional "Pages directory"
 * field, bound to the built-in `pages` root's `dir`. Collapsed by default
 * (`<details>`), it does NOT gate [Continue]; a bad path is caught by inline
 * `validatePagesDir` (and re-validated server-side, surfacing a 400 via toast).
 */

/** A cwd-relative pages dir must be non-empty, not absolute, and not escape cwd via `..`. */
export function validatePagesDir(dir: string): string | null {
  const v = dir.trim();
  if (v === '') return 'Pages directory is required';
  if (/^([A-Za-z]:[\\/]|[\\/])/.test(v)) return 'Must be a relative path inside the project';
  const norm = v.replace(/\\/g, '/');
  if (norm === '..' || norm.startsWith('../') || norm.includes('/../')) {
    return 'Path must not escape the project root';
  }
  return null;
}

export function DirectoriesSection({
  pagesDir,
  error,
  onChange,
}: {
  pagesDir: string;
  error: string | null;
  onChange: (next: string) => void;
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
          — optional, the default is fine
        </span>
      </summary>
      <div className="flex flex-col gap-4 px-4 pb-4 pt-1">
        <label className="flex flex-col gap-1.5">
          <span
            className="text-[11.5px] font-medium uppercase tracking-wide"
            style={{ color: 'var(--c-muted)' }}
          >
            Pages directory
          </span>
          <input
            type="text"
            value={pagesDir}
            onChange={(e) => onChange(e.target.value)}
            className="w-full rounded-md px-3 py-1.5 text-[13px] font-mono"
            style={{
              background: 'var(--c-card)',
              border: `1px solid ${error ? '#b3261e' : 'var(--c-hair)'}`,
              color: 'var(--c-ink)',
            }}
            placeholder="relative to project root"
          />
          {error ? (
            <span className="text-[11.5px]" style={{ color: '#b3261e' }}>
              {error}
            </span>
          ) : null}
        </label>
      </div>
    </details>
  );
}
