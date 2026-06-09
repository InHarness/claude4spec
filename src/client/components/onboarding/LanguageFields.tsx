import { FieldLabel, SelectInput } from '../../ui/Popover.js';
import { SUPPORTED_LANGUAGES } from '../../../shared/languages.js';

const NONE_VALUE = '';

function LanguageSelect({
  label,
  helper,
  value,
  onChange,
}: {
  label: string;
  helper: string;
  value: string | null;
  onChange: (next: string | null) => void;
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
    </div>
  );
}

/** 0.1.51: optional spec-authoring language dropdown. Does not gate [Continue]. */
export function SpecLanguageField({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
}) {
  return (
    <LanguageSelect
      label="Spec language"
      helper="The language the agent writes specification content in (pages, entity descriptions, briefs)."
      value={value}
      onChange={onChange}
    />
  );
}

/** 0.1.51: optional conversational language dropdown. Does not gate [Continue]. */
export function ConversationalLanguageField({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
}) {
  return (
    <LanguageSelect
      label="Conversation language"
      helper="The language the agent talks to you in (independent of the spec content language)."
      value={value}
      onChange={onChange}
    />
  );
}
