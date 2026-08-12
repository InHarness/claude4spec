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
