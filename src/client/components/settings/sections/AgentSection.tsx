import { useConfig, usePatchConfig } from '../../../hooks/useConfig.js';
import { ApiError } from '../../../lib/api.js';
import { toast } from '../../../ui/events.js';
import { SettingsCard } from '../SettingsCard.js';

/**
 * M26 §1, §2 — Agent section. Toggle for `agent.claudeUsePreset`. Hot-reload:
 * the next chat turn picks up the new value (chat.ts reads the config
 * per-request).
 */
export function AgentSection() {
  const { data: config } = useConfig();
  const patch = usePatchConfig();
  const usePreset = config?.agent?.claudeUsePreset ?? true;

  async function handleToggle(next: boolean) {
    try {
      await patch.mutateAsync({ agent: { claudeUsePreset: next } });
      toast.success('Agent settings updated');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Update failed');
    }
  }

  return (
    <SettingsCard
      id="agent"
      title="Agent"
      description="Tweaks applied to chat turns powered by Claude Code."
      badge="hot-reload"
    >
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
    </SettingsCard>
  );
}
