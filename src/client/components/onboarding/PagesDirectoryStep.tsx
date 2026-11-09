import { FieldLabel, InlineError, TextInput } from '../../ui/Popover.js';

/**
 * 2.1.77 (M16 `czn353hw`, ui-view `onboarding-page`): the common step `Pages
 * directory` — the base root's two fields, both pre-filled from the config.
 * It replaces the one-screen form's collapsible "Advanced" section.
 *
 * The two values are independent and travel by different routes: the
 * DIRECTORY rides the final `PATCH /api/config` (as `roots`), the IDENTIFIER
 * goes through `POST /api/config/roots/:rootId/rename` before it (`gipdzz10`).
 * Both are validated inline (the only rule onboarding mirrors from M01 is the
 * directory's path-safety, `swmsue1q`, plus the id's slug shape for the field
 * message); the server re-validates.
 */

/** A cwd-relative pages dir must be non-empty, not absolute, and not escape cwd via `..`. */
export function validatePagesDir(dir: string): string | null {
  const v = dir.trim();
  const message = 'Pages directory must be a relative path inside the project (no absolute paths or `..`).';
  if (v === '') return message;
  if (/^([A-Za-z]:[\\/]|[\\/])/.test(v)) return message;
  const norm = v.replace(/\\/g, '/');
  if (norm === '..' || norm.startsWith('../') || norm.includes('/../') || norm.endsWith('/..')) return message;
  return null;
}

/** The root identifier's shape — a kebab-case slug, as M01 requires of every `roots[]` entry. */
export function validateRootId(id: string): string | null {
  const v = id.trim();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v)) {
    return 'Root ID must be a kebab-case slug — no spaces, slashes or empty value.';
  }
  return null;
}

export function PagesDirectoryStep({
  pagesDir,
  pagesDirError,
  onPagesDirChange,
  rootId,
  rootIdError,
  onRootIdChange,
}: {
  pagesDir: string;
  /** Inline path-safety error, or the server's refusal of `roots`. */
  pagesDirError: string | null;
  onPagesDirChange: (next: string) => void;
  rootId: string;
  /** Inline shape error, or the server's refusal after a rejected rename. */
  rootIdError: string | null;
  onRootIdChange: (next: string) => void;
}) {
  return (
    <div data-step="pages-directory">
      <p className="text-[12.5px] mb-4" style={{ color: 'var(--c-muted)' }}>
        Keep the defaults unless you have a reason to change them.
      </p>
      <div className="mb-5">
        <FieldLabel>Pages directory</FieldLabel>
        <TextInput
          name="pagesDir"
          value={pagesDir}
          onChange={(e) => onPagesDirChange(e.target.value)}
          placeholder="relative to project root"
        />
        <div className="text-[11.5px] mt-1" style={{ color: 'var(--c-muted)' }}>
          Pages directory relative to the project directory — keep the default unless you have a reason to change it.
        </div>
        <InlineError message={pagesDirError} />
      </div>
      <div className="mb-5">
        <FieldLabel>Root ID</FieldLabel>
        <TextInput
          name="rootId"
          value={rootId}
          onChange={(e) => onRootIdChange(e.target.value)}
          placeholder="kebab-case slug"
        />
        <div className="text-[11.5px] mt-1" style={{ color: 'var(--c-muted)' }}>
          Identifier of the page space — pages and links are addressed by it; the directory is chosen separately.
        </div>
        <InlineError message={rootIdError} />
      </div>
    </div>
  );
}
