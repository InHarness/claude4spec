import type { ComponentType } from 'react';
import { FieldLabel, InlineError, TextInput } from '../../ui/Popover.js';
import { SKILL_NAME_RE } from '../../../shared/skill-name.js';
import { slugBase } from '../../../shared/slug.js';

/**
 * 2.1.77 — the type steps' browser components (M59 / M60 UI: contribution to
 * `onboarding-page`). A type entry names its step's component by id
 * (`ProjectTypeStep.component`); the wizard frame looks it up in
 * {@link TYPE_STEP_COMPONENTS} — never by the type's slug.
 *
 * A step saves nothing: it keeps its values in the wizard's state (by dotted
 * config key), validates them live (the frame enables `[Next]` only when
 * {@link TypeStepDefinition.validate} returns no message) and shows under each
 * field the refusal the final write returned for that key.
 */

export interface TypeStepProps {
  values: Readonly<Record<string, string>>;
  onChange: (key: string, value: string) => void;
  /** Refusals of the final write, by key (`skill.name`), handed back by the wizard. */
  serverErrors: Readonly<Record<string, string>>;
}

export interface TypeStepDefinition {
  /** Pre-fill when the step is first entered, from the project name typed so far. */
  initial: (ctx: { projectName: string; current: Readonly<Record<string, unknown>> }) => Record<string, string>;
  /** Live validation: one message per invalid key. */
  validate: (values: Readonly<Record<string, string>>) => Record<string, string>;
  Component: ComponentType<TypeStepProps>;
}

/**
 * The project name turned into kebab-case (the detail steps' name pre-fill),
 * by the shared slug rule (`Właściwości` → `wlasciwosci`). Empty when the name
 * gives no usable slug — never slugify's `x-<hash>` fallback — so the live
 * validation flags the field.
 */
export function namePrefill(projectName: string): string {
  return slugBase(projectName);
}

const NAME_KEY = 'skill.name';
const DESCRIPTION_KEY = 'skill.description';

interface DetailsTexts {
  intro: string;
  nameLabel: string;
  descriptionLabel: string;
  emptyDescription: string;
}

/** `Skill details` / `Style details`: one shape, two sets of texts. */
function detailsStep(texts: DetailsTexts): TypeStepDefinition {
  const validate = (values: Readonly<Record<string, string>>) => {
    const errors: Record<string, string> = {};
    if (!SKILL_NAME_RE.test((values[NAME_KEY] ?? '').trim())) errors[NAME_KEY] = 'Use lowercase letters, digits and hyphens.';
    if ((values[DESCRIPTION_KEY] ?? '').trim() === '') errors[DESCRIPTION_KEY] = texts.emptyDescription;
    return errors;
  };
  function DetailsStep({ values, onChange, serverErrors }: TypeStepProps) {
    const live = validate(values);
    return (
      <div>
        <p className="text-[12.5px] mb-4" style={{ color: 'var(--c-muted)' }}>
          {texts.intro}
        </p>
        <div className="mb-5">
          <FieldLabel>{texts.nameLabel}</FieldLabel>
          <TextInput
            name={NAME_KEY}
            value={values[NAME_KEY] ?? ''}
            onChange={(e) => onChange(NAME_KEY, e.target.value)}
          />
          <InlineError message={serverErrors[NAME_KEY] ?? live[NAME_KEY] ?? null} />
        </div>
        <div className="mb-5">
          <FieldLabel>{texts.descriptionLabel}</FieldLabel>
          <textarea
            name={DESCRIPTION_KEY}
            value={values[DESCRIPTION_KEY] ?? ''}
            onChange={(e) => onChange(DESCRIPTION_KEY, e.target.value)}
            rows={3}
            className="w-full rounded-md px-3 py-1.5 text-[13px]"
            style={{ background: 'var(--c-card)', border: '1px solid var(--c-hair)', color: 'var(--c-ink)' }}
          />
          <InlineError message={serverErrors[DESCRIPTION_KEY] ?? live[DESCRIPTION_KEY] ?? null} />
        </div>
      </div>
    );
  }
  return {
    initial: ({ projectName, current }) => {
      const skill = (current.skill ?? {}) as { name?: unknown; description?: unknown };
      return {
        [NAME_KEY]: typeof skill.name === 'string' && skill.name !== '' ? skill.name : namePrefill(projectName),
        [DESCRIPTION_KEY]: typeof skill.description === 'string' ? skill.description : '',
      };
    },
    validate,
    Component: DetailsStep,
  };
}

/** M59 `axq8papz` — the `Skill details` step. */
export const SKILL_DETAILS_STEP = detailsStep({
  intro: 'Other projects of this workspace will see this skill by its name and description.',
  nameLabel: 'Skill name',
  descriptionLabel: 'Skill description',
  emptyDescription: 'Add a description so agents know when to use this skill.',
});

/** M60 `gvo96xhp` — the `Style details` step. */
export const STYLE_DETAILS_STEP = detailsStep({
  intro: 'Other projects of this workspace will pick this style by its name and description.',
  nameLabel: 'Style name',
  descriptionLabel: 'Style description',
  emptyDescription: 'Add a description so authors know what this style is for.',
});

/** Component id (from the type entry's step) → the step's definition. */
export const TYPE_STEP_COMPONENTS: Readonly<Record<string, TypeStepDefinition>> = {
  'skill-details': SKILL_DETAILS_STEP,
  'style-details': STYLE_DETAILS_STEP,
};
