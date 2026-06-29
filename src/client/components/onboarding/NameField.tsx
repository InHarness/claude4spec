import { FieldLabel, InlineError, TextInput } from '../../ui/Popover.js';

export function NameField({
  value,
  error,
  onChange,
  onBlur,
}: {
  value: string;
  error: string | null;
  onChange: (next: string) => void;
  onBlur: () => void;
}) {
  return (
    <div className="mb-6">
      <FieldLabel>Project name</FieldLabel>
      <TextInput
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        autoFocus
        maxLength={120}
        placeholder="My specification"
      />
      <InlineError message={error} />
    </div>
  );
}

// Display-only string: a project's folder identity comes from sha1(cwd), not the
// name, so full Unicode is allowed (diacritics, CJK, emoji, `/`…). The only forbidden
// characters are C0/DEL/C1 control characters and newline/tab (both inside the C0 range).
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/;

export function validateName(s: string): string | null {
  const trimmed = s.trim();
  if (trimmed.length < 1) return 'Project name is required';
  if (trimmed.length > 80) return 'Project name must be at most 80 characters';
  if (CONTROL_CHARS.test(trimmed)) {
    return 'Project name must be 1–80 characters and cannot contain line breaks or control characters.';
  }
  return null;
}
