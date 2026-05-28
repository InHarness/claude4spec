import { useEffect, useState } from 'react';
import { useConfig } from '../../../hooks/useConfig.js';
import { SettingsCard } from '../SettingsCard.js';

interface MetaResponse {
  cwd: string;
  cwdName: string;
  c4sVersion?: string;
}

/**
 * M26 §1 — About section. Surfaces the config schema version + claude4spec
 * runtime version. Read-only.
 */
export function AboutSection() {
  const { data: config } = useConfig();
  const [meta, setMeta] = useState<MetaResponse | null>(null);

  useEffect(() => {
    fetch('/api/meta')
      .then((r) => r.json())
      .then((d: MetaResponse) => setMeta(d))
      .catch(() => {
        /* keep null */
      });
  }, []);

  return (
    <SettingsCard
      id="about"
      title="About"
      description="Build metadata for support and troubleshooting."
    >
      <div className="flex flex-col gap-2 text-[12.5px]">
        <Row label="claude4spec version" value={meta?.c4sVersion ?? '—'} />
        <Row label="Config schema" value={config ? `v${config.$schemaVersion}` : '—'} />
        <Row label="Mode" value={config?.mode ?? '—'} />
        <Row label="Project root" value={meta?.cwd ?? '—'} />
      </div>
    </SettingsCard>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <span style={{ color: 'var(--c-muted)' }}>{label}</span>
      <span className="col-span-2 truncate font-mono" style={{ color: 'var(--c-ink)' }}>
        {value}
      </span>
    </div>
  );
}
