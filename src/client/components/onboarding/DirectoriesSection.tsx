/**
 * 0.1.96: onboarding no longer edits every scalar dir — the full roots[] editor
 * lives in Settings (M26). Onboarding keeps the base root's own two fields.
 *
 * 0.2.101: TWO fields, not one — the base root's DIRECTORY and its IDENTIFIER,
 * and they are independent: changing the directory does not touch the id and
 * vice versa. They also travel by different routes, which is the whole point of
 * the split: the directory rides the ordinary `PATCH /api/config`, while the
 * identifier goes through `POST /api/config/roots/:rootId/rename`, because a
 * full `roots[]` write with a different id would be a delete plus a create.
 *
 * Both are validated inline and both gate [Continue]; the server re-validates.
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

/**
 * A root identifier must be a kebab-case slug — the same rule M01 applies to
 * every `roots[]` entry, mirrored here so the refusal reaches the user at the
 * field instead of as a 400.
 */
export function validateRootId(id: string): string | null {
  const v = id.trim();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v)) {
    return 'Root ID must be a kebab-case slug — no spaces, slashes or empty value.';
  }
  return null;
}

export function DirectoriesSection({
  pagesDir,
  error,
  onChange,
  rootId,
  rootIdError,
  onRootIdChange,
}: {
  pagesDir: string;
  error: string | null;
  onChange: (next: string) => void;
  rootId: string;
  /** Inline shape error, or the server's refusal after a rejected rename. */
  rootIdError: string | null;
  onRootIdChange: (next: string) => void;
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
        Advanced / Pages root
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
        <label className="flex flex-col gap-1.5">
          <span
            className="text-[11.5px] font-medium uppercase tracking-wide"
            style={{ color: 'var(--c-muted)' }}
          >
            Root ID
          </span>
          <input
            type="text"
            value={rootId}
            onChange={(e) => onRootIdChange(e.target.value)}
            className="w-full rounded-md px-3 py-1.5 text-[13px] font-mono"
            style={{
              background: 'var(--c-card)',
              border: `1px solid ${rootIdError ? '#b3261e' : 'var(--c-hair)'}`,
              color: 'var(--c-ink)',
            }}
            placeholder="kebab-case slug"
          />
          <span className="text-[11.5px]" style={{ color: 'var(--c-muted)' }}>
            The identifier of your pages space — pages and links are addressed under it. The
            directory is a separate choice.
          </span>
          {rootIdError ? (
            <span className="text-[11.5px]" style={{ color: '#b3261e' }}>
              {rootIdError}
            </span>
          ) : null}
        </label>
      </div>
    </details>
  );
}
