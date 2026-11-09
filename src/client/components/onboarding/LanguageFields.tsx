import { FieldLabel, InlineError, SelectInput } from '../../ui/Popover.js';
import { SUPPORTED_LANGUAGES } from '../../../shared/languages.js';

const NONE_VALUE = '';

function LanguageSelect({
  label,
  helper,
  value,
  onChange,
  error = null,
}: {
  label: string;
  helper: string;
  value: string | null;
  onChange: (next: string | null) => void;
  /** 2.1.77 (M16 `r2q6o6vi`): a refusal of the final write naming this field's key. */
  error?: string | null;
}) {
  return (
    <div className="mb-6">
      <FieldLabel>{label}</FieldLabel>
      <SelectInput
        value={value ?? NONE_VALUE}
        onChange={(e) => onChange(e.target.value === NONE_VALUE ? null : e.target.value)}
      >
        <option value={NONE_VALUE}>None</option>
        {SUPPORTED_LANGUAGES.map((lang) => (
          <option key={lang} value={lang}>
            {lang}
          </option>
        ))}
      </SelectInput>
      <div className="text-[11.5px] mt-1" style={{ color: 'var(--c-muted)' }}>
        {helper}
      </div>
      <InlineError message={error} />
    </div>
  );
}

/** 0.1.51: optional spec-authoring language dropdown. Never gates [Next]. */
export function SpecLanguageField({
  value,
  onChange,
  error,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
  error?: string | null;
}) {
  return (
    <LanguageSelect
      error={error}
      label="Spec language"
      helper="The language the agent writes the specification in."
      value={value}
      onChange={onChange}
    />
  );
}

/** 0.1.51: optional conversational language dropdown. Never gates [Next]. */
export function ConversationalLanguageField({
  value,
  onChange,
  error,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
  error?: string | null;
}) {
  return (
    <LanguageSelect
      error={error}
      label="Conversation language"
      helper="The language the agent talks to you in, independent of the specification language."
      value={value}
      onChange={onChange}
    />
  );
}
