import { useEffect, useState } from 'react';
import { useConfig, usePatchConfig } from '../../../hooks/useConfig.js';
import { ApiError, type ConfigPatch } from '../../../lib/api.js';
import { toast } from '../../../ui/events.js';
import { SettingsCard } from '../SettingsCard.js';

interface DraftState {
  pagesDir: string;
  briefsDir: string;
  patchesDir: string;
  entitiesDir: string;
}

function buildDraft(config: ReturnType<typeof useConfig>['data']): DraftState {
  return {
    pagesDir: config?.pagesDir ?? '',
    briefsDir: config?.briefsDir ?? '',
    patchesDir: config?.patchesDir ?? '',
    entitiesDir: config?.entitiesDir ?? '',
  };
}

/**
 * M31 (was M26 "Server"): project directory layout. Port/mode moved to the
 * workspace registry; directory changes rebuild the project context on the
 * next request — no restart, no banner.
 */
export function DirectoriesSection() {
  const { data: config } = useConfig();
  const patch = usePatchConfig();
  const [draft, setDraft] = useState<DraftState>(() => buildDraft(config));

  useEffect(() => {
    setDraft(buildDraft(config));
  }, [config]);

  const dirty = (() => {
    if (!config) return false;
    const baseline = buildDraft(config);
    return (
      draft.pagesDir !== baseline.pagesDir ||
      draft.briefsDir !== baseline.briefsDir ||
      draft.patchesDir !== baseline.patchesDir ||
      draft.entitiesDir !== baseline.entitiesDir
    );
  })();

  async function handleSave() {
    if (!config) return;
    const patchBody: ConfigPatch = {};
    if (draft.pagesDir !== config.pagesDir) patchBody.pagesDir = draft.pagesDir;
    if (draft.briefsDir !== config.briefsDir) patchBody.briefsDir = draft.briefsDir;
    if (draft.patchesDir !== config.patchesDir) patchBody.patchesDir = draft.patchesDir;
    if (draft.entitiesDir !== config.entitiesDir) patchBody.entitiesDir = draft.entitiesDir;
    if (Object.keys(patchBody).length === 0) return;
    try {
      await patch.mutateAsync(patchBody);
      toast.success('Directories saved');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Save failed');
    }
  }

  return (
    <SettingsCard
      id="directories"
      title="Directories"
      description="Project directory layout — applied immediately (the project context rebuilds on the next request)."
    >
      <div className="flex flex-col gap-4">
        <DirField
          label="Pages directory"
          value={draft.pagesDir}
          onChange={(v) => setDraft((d) => ({ ...d, pagesDir: v }))}
        />
        <DirField
          label="Briefs directory"
          value={draft.briefsDir}
          onChange={(v) => setDraft((d) => ({ ...d, briefsDir: v }))}
        />
        <DirField
          label="Patches directory"
          value={draft.patchesDir}
          onChange={(v) => setDraft((d) => ({ ...d, patchesDir: v }))}
        />
        <DirField
          label="Entities directory"
          value={draft.entitiesDir}
          onChange={(v) => setDraft((d) => ({ ...d, entitiesDir: v }))}
        />

        <div className="flex justify-end">
          <button
            type="button"
            disabled={!dirty || patch.isPending}
            onClick={handleSave}
            className="rounded-md px-3 py-1.5 text-[12px] font-medium disabled:opacity-50"
            style={{ background: 'var(--c-accent)', color: '#fff' }}
          >
            Save
          </button>
        </div>
      </div>
    </SettingsCard>
  );
}

function DirField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <Field label={label}>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md px-3 py-1.5 text-[13px] font-mono"
        style={inputStyle}
        placeholder="relative to project root"
      />
    </Field>
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

const inputStyle: React.CSSProperties = {
  background: 'var(--c-bg)',
  border: '1px solid var(--c-hair)',
  color: 'var(--c-ink)',
};
