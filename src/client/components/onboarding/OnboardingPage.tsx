import { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useConfig, usePatchConfig } from '../../hooks/useConfig.js';
import { useWritingStyles } from '../../hooks/useWritingStyles.js';
import { confirmDestructive, toast } from '../../ui/events.js';
import { NameField, validateName } from './NameField.js';
import { WritingStyleList, type WritingStyleSelection } from './WritingStyleList.js';
import { SpecLanguageField, ConversationalLanguageField } from './LanguageFields.js';

export function OnboardingPage() {
  const navigate = useNavigate();
  const { data: config } = useConfig();
  const { data: stylesData } = useWritingStyles();
  const patchConfig = usePatchConfig();

  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [writingStyle, setWritingStyle] = useState<WritingStyleSelection>(undefined);
  // 0.1.51: optional language dropdowns. Default null (not undefined) so they never
  // gate [Continue].
  const [language, setLanguage] = useState<string | null>(null);
  const [conversationalLanguage, setConversationalLanguage] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (config && !hydrated) {
      setName(config.name);
      // Pre-fill writingStyle dla escape-hatch rerun: jezeli user mial juz wybrane,
      // pokazujemy wybor jako zaznaczony zamiast wymuszac ponowne wskazanie.
      if (config.writingStyle !== null) {
        setWritingStyle(config.writingStyle);
      }
      setLanguage(config.language);
      setConversationalLanguage(config.agent?.conversationalLanguage ?? null);
      setHydrated(true);
    }
  }, [config, hydrated]);

  function onNameChange(next: string) {
    setName(next);
    if (nameError) setNameError(null);
  }

  function onNameBlur() {
    setName((prev) => prev.trimEnd());
    setNameError(validateName(name));
  }

  async function onContinue() {
    const err = validateName(name);
    if (err) {
      setNameError(err);
      return;
    }
    if (writingStyle === undefined) return;
    try {
      await patchConfig.mutateAsync({
        name: name.trim(),
        writingStyle,
        language,
        agent: { conversationalLanguage }, // deep-merged server-side; preserves claudeUsePreset
        onboardingCompleted: true,
      });
      toast.success('Setup complete');
      navigate({ to: '/' });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function onSkip() {
    const ok = await confirmDestructive({
      title: 'Skip onboarding?',
      body: 'You can re-enable onboarding by editing .claude4spec/config.json (set onboardingCompleted: false) and restarting the server.',
      confirmLabel: 'Skip anyway',
    });
    if (!ok) return;
    try {
      await patchConfig.mutateAsync({ onboardingCompleted: true });
      navigate({ to: '/' });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const continueDisabled =
    nameError !== null ||
    writingStyle === undefined ||
    name.trim().length === 0 ||
    patchConfig.isPending;

  return (
    <div
      className="min-h-full w-full flex items-start justify-center overflow-y-auto"
      style={{ background: 'var(--c-bg)' }}
    >
      <div
        className="w-full max-w-[640px] my-12 mx-6 px-8 py-9 rounded-lg"
        style={{
          background: 'var(--c-card)',
          border: '1px solid var(--c-hair)',
        }}
      >
        <header className="mb-6">
          <h1
            className="text-[22px] font-semibold mb-1.5"
            style={{ color: 'var(--c-ink)' }}
          >
            Welcome to claude4spec
          </h1>
          <p
            className="text-[13px] leading-relaxed"
            style={{ color: 'var(--c-muted)' }}
          >
            Two quick choices to get started — they go straight to your local
            <code
              className="mx-1 px-1 py-0.5 rounded text-[12px]"
              style={{ background: 'var(--c-panel)' }}
            >
              .claude4spec/config.json
            </code>
            .
          </p>
        </header>

        <NameField
          value={name}
          error={nameError}
          onChange={onNameChange}
          onBlur={onNameBlur}
        />

        <WritingStyleList
          available={stylesData?.available ?? []}
          selection={writingStyle}
          onSelect={(slug) => setWritingStyle(slug)}
        />

        <SpecLanguageField value={language} onChange={setLanguage} />
        <ConversationalLanguageField
          value={conversationalLanguage}
          onChange={setConversationalLanguage}
        />

        <div className="flex items-center justify-end gap-3 mt-2">
          <button
            type="button"
            onClick={onSkip}
            disabled={patchConfig.isPending}
            className="text-[13px] px-3 py-2 rounded"
            style={{
              color: 'var(--c-muted)',
              opacity: patchConfig.isPending ? 0.5 : 1,
            }}
          >
            Skip
          </button>
          <button
            type="button"
            onClick={onContinue}
            disabled={continueDisabled}
            className="text-[13px] px-4 py-2 rounded font-medium"
            style={{
              background: 'var(--c-accent)',
              color: '#fff',
              opacity: continueDisabled ? 0.55 : 1,
            }}
          >
            {patchConfig.isPending ? 'Saving…' : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  );
}
