import { useState } from 'react';
import { ApiError } from '../../../lib/api.js';
import { useConfig, usePatchConfig } from '../../../hooks/useConfig.js';
import { useWritingStyles } from '../../../hooks/useWritingStyles.js';
import { toast } from '../../../ui/events.js';
import { SettingsCard } from '../SettingsCard.js';
import { SUPPORTED_LANGUAGES } from '../../../../shared/languages.js';

/**
 * M26 §1, §2 — Project section. `name` is hot-reload; `writingStyle` and
 * `language` (0.1.51) take effect from the first turn of the next new thread
 * (the system prompt is rendered once and persisted per-thread).
 */
export function ProjectSection() {
  const { data: config } = useConfig();
  const { data: writingStyles } = useWritingStyles();
  const patch = usePatchConfig();
  const [name, setName] = useState<string>('');
  // M26 §3 — surface a 400 from an unknown writingStyle inline under the dropdown
  // (the backend rejects with `... not a selectable writing-style skill. Available: ...`).
  const [writingStyleError, setWritingStyleError] = useState<string | null>(null);
  const [languageError, setLanguageError] = useState<string | null>(null);
  const initialName = config?.name ?? '';
  const dirty = name && name !== initialName;

  // 0.1.58 — local "elevator pitch" (0–200). `null` draft = unedited (mirror the
  // config value); an empty/whitespace submit clears the field (PATCH null).
  const [descDraft, setDescDraft] = useState<string | null>(null);
  const baselineDesc = config?.description ?? '';
  const descValue = descDraft ?? baselineDesc;
  const descDirty = descDraft !== null && descDraft !== baselineDesc;

  async function handleSaveName() {
    if (!dirty) return;
    try {
      await patch.mutateAsync({ name });
      toast.success('Project name updated');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to update name');
    }
  }

  async function handleSaveDescription() {
    if (!descDirty) return;
    try {
      await patch.mutateAsync({ description: descValue.trim() === '' ? null : descValue });
      setDescDraft(null);
      toast.success('Project description updated');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to update description');
    }
  }

  async function handleChangeWritingStyle(slug: string) {
    setWritingStyleError(null);
    try {
      await patch.mutateAsync({ writingStyle: slug === '' ? null : slug });
      toast.success('Writing style updated');
    } catch (err) {
      if (err instanceof ApiError) {
        setWritingStyleError(err.message);
      } else {
        toast.error('Failed to update writing style');
      }
    }
  }

  async function handleChangeLanguage(value: string) {
    setLanguageError(null);
    try {
      await patch.mutateAsync({ language: value === '' ? null : value });
      toast.success('Spec language updated');
    } catch (err) {
      if (err instanceof ApiError) {
        setLanguageError(err.message);
      } else {
        toast.error('Failed to update spec language');
      }
    }
  }

  return (
    <SettingsCard
      id="project"
      title="Project"
      description="Name shown in the sidebar and used as the remote project label on first push."
      badge="next-new-thread"
    >
      <div className="flex flex-col gap-4">
        <Field label="Name">
          <div className="flex gap-2">
            <input
              type="text"
              value={dirty ? name : initialName}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              className="flex-1 rounded-md px-3 py-1.5 text-[13px]"
              style={{ background: 'var(--c-bg)', border: '1px solid var(--c-hair)', color: 'var(--c-ink)' }}
            />
            <button
              type="button"
              disabled={!dirty || patch.isPending}
              onClick={handleSaveName}
              className="rounded-md px-3 py-1.5 text-[12px] font-medium disabled:opacity-50"
              style={{ background: 'var(--c-accent)', color: '#fff' }}
            >
              Save
            </button>
          </div>
          <Hint>1–80 chars, [a-zA-Z0-9._- ].</Hint>
        </Field>

        <Field label="Description">
          <textarea
            value={descValue}
            onChange={(e) => setDescDraft(e.target.value)}
            maxLength={200}
            rows={2}
            placeholder="One-line elevator pitch for this specification…"
            className="w-full rounded-md px-3 py-2 text-[13px] resize-none"
            style={{ background: 'var(--c-bg)', border: '1px solid var(--c-hair)', color: 'var(--c-ink)' }}
            title="A short description of this specification, visible to agents of other projects in the workspace (helps them decide whom to consult via `c4s ask`)."
          />
          <div className="flex items-center justify-between">
            <button
              type="button"
              disabled={!descDirty || patch.isPending}
              onClick={handleSaveDescription}
              className="rounded-md px-3 py-1.5 text-[12px] font-medium disabled:opacity-50"
              style={{ background: 'var(--c-accent)', color: '#fff' }}
            >
              Save
            </button>
            <span className="text-[11px] tabular-nums" style={{ color: 'var(--c-subtle)' }}>
              {descValue.length}/200
            </span>
          </div>
          <Hint>Visible to agents of other workspace projects. Applied from their next new thread.</Hint>
        </Field>

        <Field label="Writing style">
          <select
            value={config?.writingStyle ?? ''}
            onChange={(e) => void handleChangeWritingStyle(e.target.value)}
            disabled={patch.isPending}
            className="w-full rounded-md px-3 py-1.5 text-[13px]"
            style={{ background: 'var(--c-bg)', border: '1px solid var(--c-hair)', color: 'var(--c-ink)' }}
          >
            <option value="">(none — default tone)</option>
            {writingStyles?.available.map((s) => (
              <option key={s.slug} value={s.slug}>
                {s.title}
                {s.source === 'user' ? ' — yours' : ''}
              </option>
            ))}
          </select>
          {writingStyleError ? (
            <span className="text-[11.5px]" style={{ color: '#a83232' }}>
              {writingStyleError}
            </span>
          ) : (
            <Hint>Applied from the first turn of your next new thread — no restart needed.</Hint>
          )}
        </Field>

        <Field label="Spec language">
          <select
            value={config?.language ?? ''}
            onChange={(e) => void handleChangeLanguage(e.target.value)}
            disabled={patch.isPending}
            className="w-full rounded-md px-3 py-1.5 text-[13px]"
            style={{ background: 'var(--c-bg)', border: '1px solid var(--c-hair)', color: 'var(--c-ink)' }}
            title="The language the agent writes specification content in (pages, entity descriptions, briefs). Not the conversation language — set that in the Agent section."
          >
            <option value="">(none)</option>
            {SUPPORTED_LANGUAGES.map((lang) => (
              <option key={lang} value={lang}>
                {lang}
              </option>
            ))}
          </select>
          {languageError ? (
            <span className="text-[11.5px]" style={{ color: '#a83232' }}>
              {languageError}
            </span>
          ) : (
            <Hint>The language the agent writes spec content in. Applied from your next new thread.</Hint>
          )}
        </Field>
      </div>
    </SettingsCard>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11.5px] font-medium uppercase tracking-wide" style={{ color: 'var(--c-muted)' }}>
        {label}
      </span>
      {children}
    </label>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px]" style={{ color: 'var(--c-subtle)' }}>
      {children}
    </span>
  );
}
