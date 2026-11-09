import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useConfig, usePatchConfig, useRenameRoot } from '../../hooks/useConfig.js';
import { useWritingStyles } from '../../hooks/useWritingStyles.js';
import { projectTypeNameFor, useProjectTypes } from '../../hooks/useProjectTypes.js';
import { openModal, toast } from '../../ui/events.js';
import { InlineError } from '../../ui/Popover.js';
import { NameField, validateName } from './NameField.js';
import { WritingStyleList, type WritingStyleSelection } from './WritingStyleList.js';
import { SpecLanguageField, ConversationalLanguageField } from './LanguageFields.js';
import { PagesDirectoryStep, validatePagesDir, validateRootId } from './PagesDirectoryStep.js';
import { TYPE_STEP_COMPONENTS } from './typeSteps.js';
import { skipOnboarding, submitOnboarding } from './onboardingFlow.js';
import {
  PROJECT_TYPE_ONBOARDING,
  composeWizardSteps,
  stepIndexForKey,
  type WizardStep,
} from '../../../shared/onboarding-steps.js';

/**
 * 2.1.77 (M16 `czn353hw`, ui-view `onboarding-page`): onboarding is a WIZARD —
 * one step per screen inside the ~640 px card, a header with the project type's
 * name (from its registry entry) and `Step <n> of <m>`, an action bar with
 * `[Skip]` on every step, `[Back]` from the second step, `[Next]` on every step
 * but the last (enabled when the step's values are valid) and `[Continue]` on
 * the last, which sends the final write. It replaces the one-screen form with
 * its collapsible "Advanced" section.
 *
 * The step list is composed from the current project's type entry only
 * (`composeWizardSteps`): the four common steps, the type's steps inserted by
 * position, a common step a type step replaces left out. The type comes from
 * the same config read as the pre-fill values; its slug is only the key of the
 * entry — the frame has no branch on it.
 *
 * Steps save nothing: every value lives in this frame's state, so `[Back]` /
 * `[Next]` keep them. A refusal of the final write naming a key moves the
 * wizard to the step collecting that key with the message under its field; a
 * refused rename moves it to `Pages directory` (`gipdzz10`).
 */
export function OnboardingPage() {
  const navigate = useNavigate();
  const { data: config, refetch: refetchConfig } = useConfig();
  const { data: stylesData } = useWritingStyles();
  const { data: typesData } = useProjectTypes();
  const patchConfig = usePatchConfig();
  const renameRoot = useRenameRoot();

  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [writingStyle, setWritingStyle] = useState<WritingStyleSelection>(undefined);
  const [language, setLanguage] = useState<string | null>(null);
  const [conversationalLanguage, setConversationalLanguage] = useState<string | null>(null);
  // The base root's two fields, found by the `builtin` flag — never by the literal `pages`.
  const [pagesDir, setPagesDir] = useState('');
  const [rootId, setRootId] = useState('');
  const [rootIdError, setRootIdError] = useState<string | null>(null);
  /** The type steps' values, by dotted config key. */
  const [typeValues, setTypeValues] = useState<Record<string, string>>({});
  /** Refusals of the final write, by the key they name. */
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [index, setIndex] = useState(0);
  const [hydrated, setHydrated] = useState(false);

  const steps: WizardStep[] = useMemo(
    () => composeWizardSteps(config ? PROJECT_TYPE_ONBOARDING[config.projectType] : null),
    [config?.projectType],
  );
  const typeName = projectTypeNameFor(typesData, config?.projectType);

  useEffect(() => {
    if (config && !hydrated) {
      setName(config.name);
      // Escape-hatch rerun: a style already chosen shows as selected.
      if (config.writingStyle !== null) setWritingStyle(config.writingStyle);
      setLanguage(config.language);
      setConversationalLanguage(config.agent?.conversationalLanguage ?? null);
      const baseRoot = config.roots.find((r) => r.builtin);
      setPagesDir(baseRoot?.dir ?? '');
      setRootId(baseRoot?.id ?? '');
      setHydrated(true);
      fillTypeStep(0, config.name);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, hydrated]);

  /** A type step entered for the first time gets its pre-fill; later visits keep what was typed. */
  function fillTypeStep(i: number, projectName: string) {
    const step = steps[i];
    if (!step || step.kind !== 'type') return;
    const def = TYPE_STEP_COMPONENTS[step.component];
    if (!def) return;
    const initial = def.initial({ projectName, current: (config ?? {}) as unknown as Record<string, unknown> });
    setTypeValues((prev) => {
      const next = { ...prev };
      for (const [k, v] of Object.entries(initial)) if (!(k in next)) next[k] = v;
      return next;
    });
  }

  function goTo(i: number) {
    fillTypeStep(i, name);
    setIndex(i);
  }

  const clearServerError = (key: string) =>
    setServerErrors((prev) => {
      if (!(key in prev)) return prev;
      const { [key]: _gone, ...rest } = prev;
      return rest;
    });

  function stepValid(step: WizardStep): boolean {
    if (step.kind === 'type') {
      const def = TYPE_STEP_COMPONENTS[step.component];
      return def ? Object.keys(def.validate(typeValues)).length === 0 : true;
    }
    switch (step.title) {
      case 'Project name':
        return validateName(name) === null;
      case 'Writing style':
        return writingStyle !== undefined;
      case 'Pages directory':
        return validatePagesDir(pagesDir) === null && validateRootId(rootId) === null && rootIdError === null;
      default:
        // `Languages` never blocks.
        return true;
    }
  }

  const saving = patchConfig.isPending || renameRoot.isPending;
  const step = steps[index];
  const last = index === steps.length - 1;
  const nextDisabled = !step || !stepValid(step) || saving;

  async function onContinue() {
    if (!config || writingStyle === undefined) return;
    const invalid = steps.findIndex((s) => !stepValid(s));
    if (invalid >= 0) {
      goTo(invalid);
      return;
    }
    try {
      const result = await submitOnboarding(
        { name, writingStyle, language, conversationalLanguage, pagesDir, rootId, typeValues },
        {
          config,
          renameRoot: (input) => renameRoot.mutateAsync(input),
          refetchConfig: async () => (await refetchConfig()).data,
          patchConfig: (body) => patchConfig.mutateAsync(body),
          navigate: (to) => navigate({ to }),
        },
      );
      if (result.ok) {
        toast.success('Setup complete');
        return;
      }
      if ('rootIdError' in result) {
        setRootIdError(result.rootIdError);
        const at = stepIndexForKey(steps, 'roots');
        if (at >= 0) setIndex(at);
        return;
      }
      if ('fieldError' in result) {
        const at = stepIndexForKey(steps, result.fieldError.key);
        if (at < 0) {
          // A refusal for a key no step collects takes the standard mutation-error path.
          toast.error(result.fieldError.message);
          return;
        }
        setServerErrors((prev) => ({ ...prev, [result.fieldError.key]: result.fieldError.message }));
        setIndex(at);
      }
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function onSkip() {
    try {
      await skipOnboarding({
        confirm: async () => (await openModal('onboarding-skip', {})) === true,
        patchConfig: (body) => patchConfig.mutateAsync(body),
        navigate: (to) => navigate({ to }),
      });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  function renderStep(s: WizardStep) {
    if (s.kind === 'type') {
      const def = TYPE_STEP_COMPONENTS[s.component];
      if (!def) return null;
      const Step = def.Component;
      return (
        <Step
          values={typeValues}
          serverErrors={serverErrors}
          onChange={(key, value) => {
            setTypeValues((prev) => ({ ...prev, [key]: value }));
            clearServerError(key);
          }}
        />
      );
    }
    switch (s.title) {
      case 'Project name':
        return (
          <NameField
            value={name}
            error={serverErrors.name ?? nameError ?? (hydrated && name.trim() === '' ? validateName(name) : null)}
            onChange={(next) => {
              setName(next);
              setNameError(validateName(next));
              clearServerError('name');
            }}
            onBlur={() => setName((prev) => prev.trimEnd())}
          />
        );
      case 'Writing style':
        return (
          <>
            <WritingStyleList
              available={stylesData?.available ?? []}
              selection={writingStyle}
              onSelect={(slug) => {
                setWritingStyle(slug);
                clearServerError('writingStyle');
              }}
            />
            <InlineError message={serverErrors.writingStyle ?? null} />
          </>
        );
      case 'Languages':
        return (
          <>
            <SpecLanguageField
              value={language}
              error={serverErrors.language ?? null}
              onChange={(next) => {
                setLanguage(next);
                clearServerError('language');
              }}
            />
            <ConversationalLanguageField
              value={conversationalLanguage}
              error={serverErrors['agent.conversationalLanguage'] ?? null}
              onChange={(next) => {
                setConversationalLanguage(next);
                clearServerError('agent.conversationalLanguage');
              }}
            />
          </>
        );
      case 'Pages directory':
        return (
          <PagesDirectoryStep
            pagesDir={pagesDir}
            pagesDirError={serverErrors.roots ?? (hydrated ? validatePagesDir(pagesDir) : null)}
            onPagesDirChange={(next) => {
              setPagesDir(next);
              clearServerError('roots');
            }}
            rootId={rootId}
            rootIdError={hydrated ? (rootIdError ?? validateRootId(rootId)) : null}
            onRootIdChange={(next) => {
              setRootId(next);
              // A server refusal is about the SUBMITTED value — editing makes it stale.
              if (rootIdError) setRootIdError(null);
            }}
          />
        );
      default:
        return null;
    }
  }

  return (
    <div className="h-full w-full flex items-start justify-center overflow-y-auto" style={{ background: 'var(--c-bg)' }}>
      <div
        className="w-full max-w-[640px] my-12 mx-6 px-8 py-9 rounded-lg"
        style={{ background: 'var(--c-card)', border: '1px solid var(--c-hair)' }}
      >
        <header className="mb-6">
          <div className="flex items-baseline justify-between gap-3 mb-1.5">
            <h1 data-testid="onboarding-type-name" className="text-[22px] font-semibold" style={{ color: 'var(--c-ink)' }}>
              {typeName ?? ''}
            </h1>
            <span data-testid="onboarding-progress" className="text-[12px] font-mono" style={{ color: 'var(--c-muted)' }}>
              {step ? `Step ${index + 1} of ${steps.length}` : ''}
            </span>
          </div>
          {step ? (
            <h2 data-testid="onboarding-step-title" className="text-[15px] font-medium" style={{ color: 'var(--c-ink)' }}>
              {step.title}
            </h2>
          ) : null}
        </header>

        {hydrated && step ? <div data-testid="onboarding-step">{renderStep(step)}</div> : null}

        <div className="flex items-center justify-end gap-3 mt-2">
          <button
            type="button"
            onClick={onSkip}
            disabled={saving}
            className="text-[13px] px-3 py-2 rounded"
            style={{ color: 'var(--c-muted)', opacity: saving ? 0.5 : 1 }}
          >
            Skip
          </button>
          {index > 0 ? (
            <button
              type="button"
              onClick={() => setIndex(index - 1)}
              disabled={saving}
              className="text-[13px] px-3 py-2 rounded"
              style={{ color: 'var(--c-ink)', border: '1px solid var(--c-hair)', opacity: saving ? 0.5 : 1 }}
            >
              Back
            </button>
          ) : null}
          {last ? (
            <button
              type="button"
              onClick={onContinue}
              disabled={nextDisabled}
              className="text-[13px] px-4 py-2 rounded font-medium"
              style={{ background: 'var(--c-accent)', color: '#fff', opacity: nextDisabled ? 0.55 : 1 }}
            >
              {saving ? 'Saving...' : 'Continue'}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => goTo(index + 1)}
              disabled={nextDisabled}
              className="text-[13px] px-4 py-2 rounded font-medium"
              style={{ background: 'var(--c-accent)', color: '#fff', opacity: nextDisabled ? 0.55 : 1 }}
            >
              Next
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
