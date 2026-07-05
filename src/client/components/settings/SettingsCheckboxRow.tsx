import type { ReactNode } from 'react';

interface SettingsCheckboxRowProps {
  checked: boolean;
  onChange: () => void;
  /** Title/subtitle content — callers keep full control of typography. */
  children: ReactNode;
  /** Optional trailing content (e.g. a badge) after the title/subtitle block. */
  trailing?: ReactNode;
}

/**
 * Shared checkbox-list-item row for Settings sections (EntitiesSection,
 * ExternalSkillsSection, ...). Factors out the label/checkbox/wrapper
 * structure that was previously copy-pasted per section; typography of the
 * title/subtitle is left to the caller via `children` since it varies
 * per-section.
 */
export function SettingsCheckboxRow({ checked, onChange, children, trailing }: SettingsCheckboxRowProps) {
  return (
    <label
      className="flex items-center gap-3 rounded-md px-3 py-2"
      style={{ background: 'var(--c-bg)', border: '1px solid var(--c-hair)' }}
    >
      <input type="checkbox" checked={checked} onChange={onChange} className="h-4 w-4" />
      <span className="flex-1 min-w-0">{children}</span>
      {trailing}
    </label>
  );
}
