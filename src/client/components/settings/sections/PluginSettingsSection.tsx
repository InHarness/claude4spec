import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { PluginSettingField } from '../../../../shared/plugin-host/manifest.js';
import { useConfig, usePatchConfig } from '../../../hooks/useConfig.js';
import { ApiError, metaApi } from '../../../lib/api.js';
import { toast } from '../../../ui/events.js';
import { SettingsCard } from '../SettingsCard.js';

/**
 * M33 phase 3 — one Settings section per loaded + trusted plugin that
 * contributes `contributes.settings`. Sourced from GET /api/_meta/plugin-settings
 * (axis B — pool + trust, NOT filtered by `config.entities`, so a plugin's
 * settings survive deactivation of its entity types). Values bind to
 * `config.plugins[<name>][key]`; a PATCH deep-merges per plugin so writing one
 * field preserves the rest. Per-field `kind` drives the reload: `hot-reload`
 * fields take effect next turn/thread (no rebuild); `executive` fields rebuild
 * the context server-side (no restart). Values persist even when the plugin is
 * later absent/inactive (user data preserved).
 */
export function PluginSettingsSection() {
  const { data: sections } = useQuery({
    queryKey: ['plugin-settings'],
    queryFn: () => metaApi.pluginSettings().then((r) => r.sections),
  });
  if (!sections || sections.length === 0) return null;
  return (
    <>
      {sections.map((s) => (
        <PluginCard key={s.name} name={s.name} version={s.version} fields={s.fields} />
      ))}
    </>
  );
}

function PluginCard({
  name,
  version,
  fields,
}: {
  name: string;
  version: string;
  fields: PluginSettingField[];
}) {
  const { data: config } = useConfig();
  const patch = usePatchConfig();
  const values = config?.plugins?.[name] ?? {};

  async function save(key: string, value: unknown) {
    try {
      await patch.mutateAsync({ plugins: { [name]: { [key]: value } } });
      toast.success('Plugin settings updated');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Update failed');
    }
  }

  return (
    <SettingsCard
      id={`plugin-${name}`}
      title={name}
      description={`Settings contributed by ${name} v${version}.`}
      badge="hot-reload"
    >
      <div className="flex flex-col gap-4">
        {fields.map((field) => (
          <FieldRow
            key={field.key}
            field={field}
            value={values[field.key] ?? field.default}
            disabled={patch.isPending}
            onSave={(v) => void save(field.key, v)}
          />
        ))}
      </div>
    </SettingsCard>
  );
}

function FieldRow({
  field,
  value,
  disabled,
  onSave,
}: {
  field: PluginSettingField;
  value: unknown;
  disabled: boolean;
  onSave: (value: unknown) => void;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium" style={{ color: 'var(--c-ink)' }}>
            {field.label}
          </span>
          <KindBadge kind={field.kind} />
        </div>
        {field.help ? (
          <p className="text-[11.5px] mt-0.5" style={{ color: 'var(--c-subtle)' }}>
            {field.help}
          </p>
        ) : null}
      </div>
      <div className="shrink-0">
        <FieldControl field={field} value={value} disabled={disabled} onSave={onSave} />
      </div>
    </div>
  );
}

function FieldControl({
  field,
  value,
  disabled,
  onSave,
}: {
  field: PluginSettingField;
  value: unknown;
  disabled: boolean;
  onSave: (value: unknown) => void;
}) {
  // Local buffer for free-text so we save on blur/Enter rather than per-keystroke.
  const [text, setText] = useState(typeof value === 'string' ? value : '');

  if (field.control === 'toggle') {
    return (
      <input
        type="checkbox"
        checked={Boolean(value)}
        disabled={disabled}
        onChange={(e) => onSave(e.target.checked)}
        className="h-4 w-4"
      />
    );
  }

  if (field.control === 'select') {
    return (
      <select
        value={typeof value === 'string' ? value : ''}
        disabled={disabled}
        onChange={(e) => onSave(e.target.value)}
        className="rounded-md px-2 py-1 text-[12.5px]"
        style={{ background: 'var(--c-bg)', border: '1px solid var(--c-hair)', color: 'var(--c-ink)' }}
      >
        {(field.options ?? []).map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }

  if (field.control === 'multiselect') {
    const selected = new Set(Array.isArray(value) ? (value as string[]) : []);
    return (
      <div className="flex flex-col items-end gap-1">
        {(field.options ?? []).map((o) => (
          <label key={o.value} className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--c-ink)' }}>
            {o.label}
            <input
              type="checkbox"
              checked={selected.has(o.value)}
              disabled={disabled}
              onChange={(e) => {
                const next = new Set(selected);
                if (e.target.checked) next.add(o.value);
                else next.delete(o.value);
                onSave([...next]);
              }}
              className="h-4 w-4"
            />
          </label>
        ))}
      </div>
    );
  }

  // text
  return (
    <input
      type="text"
      value={text}
      disabled={disabled}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (text !== value) onSave(text);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
      className="rounded-md px-2 py-1 text-[12.5px] w-48"
      style={{ background: 'var(--c-bg)', border: '1px solid var(--c-hair)', color: 'var(--c-ink)' }}
    />
  );
}

function KindBadge({ kind }: { kind: PluginSettingField['kind'] }) {
  const label = kind === 'executive' ? 'rebuild' : 'hot-reload';
  return (
    <span
      className="rounded-full px-1.5 py-0.5 text-[9.5px] font-medium uppercase tracking-wide"
      style={{ background: 'var(--c-accent-soft)', color: 'var(--c-accent)' }}
      title={
        kind === 'executive'
          ? 'Changing this rebuilds the project context (no restart).'
          : 'Takes effect from the next turn / new thread (no rebuild).'
      }
    >
      {label}
    </span>
  );
}
