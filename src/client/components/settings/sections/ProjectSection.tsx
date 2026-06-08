import { useState } from 'react';
import { ApiError } from '../../../lib/api.js';
import { useConfig, usePatchConfig } from '../../../hooks/useConfig.js';
import { useWritingStyles } from '../../../hooks/useWritingStyles.js';
import { toast } from '../../../ui/events.js';
import { SettingsCard } from '../SettingsCard.js';

/**
 * M26 §1, §2 — Project section. Hot-reload fields only (`name`,
 * `writingStyle`). The writing-style change takes effect on the next chat
 * turn (SkillResolver reads the config per query).
 */
export function ProjectSection() {
  const { data: config } = useConfig();
  const { data: writingStyles } = useWritingStyles();
  const patch = usePatchConfig();
  const [name, setName] = useState<string>('');
  // M26 §3 — surface a 400 from an unknown writingStyle inline under the dropdown
  // (the backend rejects with `... not a selectable writing-style skill. Available: ...`).
  const [writingStyleError, setWritingStyleError] = useState<string | null>(null);
  const initialName = config?.name ?? '';
  const dirty = name && name !== initialName;

  async function handleSaveName() {
    if (!dirty) return;
    try {
      await patch.mutateAsync({ name });
      toast.success('Project name updated');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to update name');
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

  return (
    <SettingsCard
      id="project"
      title="Project"
      description="Name shown in the sidebar and used as the remote project label on first push."
      badge="hot-reload"
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
            <Hint>Applied on the next chat turn — no restart needed.</Hint>
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
