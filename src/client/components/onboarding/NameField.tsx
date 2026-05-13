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

export function validateName(s: string): string | null {
  const trimmed = s.trim();
  if (trimmed.length < 1) return 'Project name is required';
  if (trimmed.length > 80) return 'Project name must be at most 80 characters';
  if (!/^[a-zA-Z0-9._\- ]+$/.test(trimmed)) {
    return 'Allowed characters: letters, digits, spaces, dots, dashes, underscores';
  }
  return null;
}
