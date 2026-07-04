import { withStability } from '../stability.js';

/**
 * `RichTextField` (Panel detalu, `experimental`) — a markdown description
 * editor. Lowest-priority component in this group (brief: "build when a real
 * consumer needs it") — a plain textarea for now rather than a Tiptap
 * integration, to avoid pulling editor internals into a pure-presentational
 * kit component before a real consumer defines what it actually needs.
 */
export interface RichTextFieldProps {
  value: string;
  onChange(value: string): void;
  readOnly?: boolean;
  placeholder?: string;
}

function RichTextFieldImpl({ value, onChange, readOnly, placeholder }: RichTextFieldProps) {
  if (readOnly) {
    return (
      <div
        className="whitespace-pre-wrap text-[13px] rounded-md px-3 py-2"
        style={{ color: value ? 'var(--c-ink)' : 'var(--c-subtle)', background: 'var(--c-panel)' }}
      >
        {value || placeholder}
      </div>
    );
  }

  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={6}
      className="w-full rounded-md px-3 py-2 text-[13px] nice-scroll"
      style={{
        background: 'var(--c-card)',
        color: 'var(--c-ink)',
        border: '1px solid var(--c-hair)',
        resize: 'vertical',
      }}
    />
  );
}

export const RichTextField = withStability(RichTextFieldImpl, 'experimental');
