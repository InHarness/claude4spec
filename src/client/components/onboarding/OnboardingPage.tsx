import { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useConfig, usePatchConfig, useRenameRoot } from '../../hooks/useConfig.js';
import type { ConfigPatch } from '../../lib/api.js';
import { useWritingStyles } from '../../hooks/useWritingStyles.js';
import { openModal, toast } from '../../ui/events.js';
import { NameField, validateName } from './NameField.js';
import { WritingStyleList, type WritingStyleSelection } from './WritingStyleList.js';
import { SpecLanguageField, ConversationalLanguageField } from './LanguageFields.js';
import { DirectoriesSection, validatePagesDir, validateRootId } from './DirectoriesSection.js';

export function OnboardingPage() {
  const navigate = useNavigate();
  const { data: config, refetch: refetchConfig } = useConfig();
  const { data: stylesData } = useWritingStyles();
  const patchConfig = usePatchConfig();
  const renameRoot = useRenameRoot();

  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [writingStyle, setWritingStyle] = useState<WritingStyleSelection>(undefined);
  // 0.1.51: optional language dropdowns. Default null (not undefined) so they never
  // gate [Continue].
  const [language, setLanguage] = useState<string | null>(null);
  const [conversationalLanguage, setConversationalLanguage] = useState<string | null>(null);
  // 0.1.96: onboarding edits the BASE root's dir. Pre-filled from config.roots
  // (also covers escape-hatch rerun pre-fill); the full roots[] editor lives in
  // Settings. Empty default until hydrated.
  const [pagesDir, setPagesDir] = useState('');
  /**
   * 0.2.101: the base root's IDENTIFIER — a second, independent field. Also
   * pre-filled, so an escape-hatch rerun shows what the project actually uses
   * rather than the default `pages`.
   */
  const [rootId, setRootId] = useState('');
  const [rootIdError, setRootIdError] = useState<string | null>(null);
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
      // 0.2.101: found by the `builtin` flag — the base root may be called
      // anything, and the literal `'pages'` would pre-fill from the wrong entry
      // (or from none at all).
      const baseRoot = config.roots.find((r) => r.builtin);
      setPagesDir(baseRoot?.dir ?? '');
      setRootId(baseRoot?.id ?? '');
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

  /**
   * [Continue] is TWO steps since 0.2.101, and their ORDER IS THE CONTRACT:
   * rename first, re-read the config, then PATCH the rest built from what came
   * back.
   *
   * Three consequences follow from that order, and each is deliberate:
   *
   * - A REFUSED RENAME ABORTS THE SUBMIT. `onboardingCompleted: true` is never
   *   sent, the user stays on the form, and the message lands under the Root ID
   *   field rather than in a generic toast. Since onboarding did not close, no
   *   welcome `index.md` is written either — the condition is "onboarding closed
   *   SUCCESSFULLY", not merely "onboarding was attempted".
   * - A SECOND ATTEMPT READS STATE AFRESH. The refetched config carries a new
   *   `configHash` and the current id, so pressing [Continue] again cannot bounce
   *   off a stale token. A rename that actually succeeded but whose response was
   *   lost comes back `alreadyApplied` and does not migrate anything twice.
   * - THE DIRECTORY WRITE IS COMPOSED FROM THE REFRESHED CONFIG, so its
   *   full-array `roots` cannot overwrite the identifier that was just changed.
   */
  async function onContinue() {
    const err = validateName(name);
    if (err) {
      setNameError(err);
      return;
    }
    if (writingStyle === undefined) return;
    if (validatePagesDir(pagesDir) !== null) return;
    const idErr = validateRootId(rootId);
    if (idErr) {
      setRootIdError(idErr);
      return;
    }
    if (!config) return;
    try {
      let current = config;
      const baseRoot = current.roots.find((r) => r.builtin);
      if (baseRoot && rootId.trim() !== baseRoot.id) {
        try {
          await renameRoot.mutateAsync({
            rootId: baseRoot.id,
            newId: rootId.trim(),
            expectedConfigHash: current.configHash,
          });
        } catch (e) {
          setRootIdError((e as Error).message);
          return;
        }
        const refetched = await refetchConfig();
        if (!refetched.data) return;
        current = refetched.data;
      }

      const baseAfter = current.roots.find((r) => r.builtin);
      const patchBody: ConfigPatch = {
        name: name.trim(),
        writingStyle,
        language,
        agent: { conversationalLanguage }, // deep-merged server-side; preserves claudeUsePreset
        onboardingCompleted: true,
      };
      // 0.1.96: send `roots` only if the pages dir actually changed — a full-array
      // replace that swaps the base root's dir (all other roots and props
      // preserved). A changed dir rebuilds the context and the deferred welcome
      // lands on the new path.
      if (baseAfter && pagesDir.trim() !== baseAfter.dir) {
        patchBody.roots = current.roots.map((r) =>
          r.builtin ? { ...r, dir: pagesDir.trim() } : r,
        );
      }
      await patchConfig.mutateAsync(patchBody);
      toast.success('Setup complete');
      navigate({ to: '/' });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function onSkip() {
    const ok = await openModal('onboarding-skip', {});
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
    validatePagesDir(pagesDir) !== null ||
    // 0.2.101: the identifier gates [Continue] exactly as the directory does —
    // it is submitted by the same button, just over a different route.
    rootIdError !== null ||
    validateRootId(rootId) !== null ||
    patchConfig.isPending ||
    renameRoot.isPending;

  return (
    <div
      className="h-full w-full flex items-start justify-center overflow-y-auto"
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

        <DirectoriesSection
          pagesDir={pagesDir}
          error={hydrated ? validatePagesDir(pagesDir) : null}
          onChange={setPagesDir}
          rootId={rootId}
          rootIdError={hydrated ? (rootIdError ?? validateRootId(rootId)) : null}
          onRootIdChange={(next) => {
            setRootId(next);
            // A server refusal (a taken id, a stale config hash) is about the
            // value that was SUBMITTED — editing the field makes it stale, so it
            // clears and the inline shape rule takes over again.
            if (rootIdError) setRootIdError(null);
          }}
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
