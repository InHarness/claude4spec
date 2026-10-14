/**
 * DEBT (2.1.20, Host UI Kit slice of M21): the view switcher on `briefs-list`
 * and `brief-page` is this host `SegmentedControl` from outside the catalog. It
 * fails locality condition 2 — it is universal across entity types. Its catalog
 * replacement is `SegmentedControlTabs`. Recorded, not fixed here.
 */
import { ButtonGroup, SegmentButton } from './ButtonGroup.js';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: React.ReactNode;
  title?: string;
  disabled?: boolean;
}

interface Props<T extends string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

export function SegmentedControl<T extends string>({ options, value, onChange }: Props<T>) {
  return (
    <ButtonGroup>
      {options.map((o) => (
        <SegmentButton
          key={o.value}
          icon={o.icon}
          label={o.label}
          active={value === o.value}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          title={o.title ?? o.label}
        />
      ))}
    </ButtonGroup>
  );
}
