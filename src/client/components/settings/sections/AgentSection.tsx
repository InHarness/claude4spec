import { useState } from 'react';
import { useConfig, usePatchConfig } from '../../../hooks/useConfig.js';
import { ApiError } from '../../../lib/api.js';
import { toast } from '../../../ui/events.js';
import { SettingsCard } from '../SettingsCard.js';
import { SUPPORTED_LANGUAGES } from '../../../../shared/languages.js';

/**
 * M26 §1, §2 — Agent section. `claudeUsePreset` is per-query hot-reload (the next
 * chat turn picks it up). `conversationalLanguage` (0.1.51) takes effect only from
 * the first turn of the next new thread (prompt persisted per-thread).
 */
export function AgentSection() {
  const { data: config } = useConfig();
  const patch = usePatchConfig();
  const usePreset = config?.agent?.claudeUsePreset ?? true;
  const [languageError, setLanguageError] = useState<string | null>(null);

  async function handleToggle(next: boolean) {
    try {
      await patch.mutateAsync({ agent: { claudeUsePreset: next } });
      toast.success('Agent settings updated');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Update failed');
    }
  }

  async function handleChangeConversationalLanguage(value: string) {
    setLanguageError(null);
    try {
      // Deep-merged server-side — sending conversationalLanguage alone preserves claudeUsePreset.
      await patch.mutateAsync({ agent: { conversationalLanguage: value === '' ? null : value } });
      toast.success('Conversation language updated');
    } catch (err) {
      if (err instanceof ApiError) {
        setLanguageError(err.message);
      } else {
        toast.error('Failed to update conversation language');
      }
    }
  }

  return (
    <SettingsCard
      id="agent"
      title="Agent"
      description="Tweaks applied to chat turns powered by Claude Code."
      badge="hot-reload"
    >
      <div className="flex flex-col gap-4">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={usePreset}
            onChange={(e) => void handleToggle(e.target.checked)}
            disabled={patch.isPending}
            className="mt-0.5 h-4 w-4"
          />
          <span className="flex-1">
            <span className="block text-[13px] font-medium" style={{ color: 'var(--c-ink)' }}>
              Append the Claude Code preset to the system prompt
            </span>
            <span className="block text-[11.5px] mt-0.5" style={{ color: 'var(--c-subtle)' }}>
              Default. Turn off only when the writing-style skill provides its own complete preset.
            </span>
          </span>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[11.5px] font-medium uppercase tracking-wide" style={{ color: 'var(--c-muted)' }}>
            Conversation language
          </span>
          <select
            value={config?.agent?.conversationalLanguage ?? ''}
            onChange={(e) => void handleChangeConversationalLanguage(e.target.value)}
            disabled={patch.isPending}
            className="w-full rounded-md px-3 py-1.5 text-[13px]"
            style={{ background: 'var(--c-bg)', border: '1px solid var(--c-hair)', color: 'var(--c-ink)' }}
            title="The language the agent always replies to you in, regardless of the question's language. Not the spec content language — set that in the Project section."
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
            <span className="text-[11px]" style={{ color: 'var(--c-subtle)' }}>
              The agent replies in this language regardless of your input. Applied from your next new thread.
            </span>
          )}
        </label>
      </div>
    </SettingsCard>
  );
}
