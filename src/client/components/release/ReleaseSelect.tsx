import type { CSSProperties } from 'react';

interface ReleaseSelectRelease {
  id: number;
  name: string;
}

export interface ReleaseSelectOption {
  value: string;
  label: string;
}

interface ReleaseSelectProps {
  releases: ReleaseSelectRelease[];
  value: string;
  onChange: (value: string) => void;
  /** Rendered as `<option>`s before the release list — e.g. "— none —" / a sentinel like "__INITIAL__". */
  leadingOptions?: ReleaseSelectOption[];
  /** Release name to omit from the list (e.g. "don't let me compare a release to itself"). */
  excludeName?: string;
  /** When a release's id matches, its option label gets a " (latest)" suffix. */
  latestId?: number;
  required?: boolean;
  className?: string;
  style?: CSSProperties;
}

/**
 * Shared release-picker `<select>` (0.1.122 code-review fix — was
 * copy-pasted three times: `ReleaseDetail`'s "Compare to:", `CreateBriefDialog`'s
 * "From release", and `ReleasesCompareTab`'s "Compare:"). Each caller supplies
 * its own leading sentinel options and exclusion/latest-marking behavior.
 */
export function ReleaseSelect({
  releases,
  value,
  onChange,
  leadingOptions = [],
  excludeName,
  latestId,
  required,
  className = 'rounded-md px-2 py-1 text-[12.5px] font-mono',
  style,
}: ReleaseSelectProps) {
  const options = excludeName ? releases.filter((r) => r.name !== excludeName) : releases;
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      required={required}
      className={className}
      style={{
        background: 'var(--c-card)',
        border: '1px solid var(--c-hair)',
        color: 'var(--c-ink)',
        ...style,
      }}
    >
      {leadingOptions.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
      {options.map((r) => (
        <option key={r.id} value={r.name}>
          {r.name}
          {latestId != null && r.id === latestId ? ' (latest)' : ''}
        </option>
      ))}
    </select>
  );
}
