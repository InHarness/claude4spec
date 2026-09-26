import { useEffect, useState } from 'react';
import { apiFetch } from '../../../lib/api-core.js';
import { useConfig } from '../../../hooks/useConfig.js';

interface MetaResponse {
  cwd: string;
  cwdName: string;
  c4sVersion?: string;
}

/**
 * M26 §1 — About. Surfaces the config schema version + claude4spec runtime
 * version. Read-only. 0.2.113: the version comes from `GET /api/config`'s `appVersion`; `/api/meta`
 * still supplies the project root (and the version, for a server without it).
 */
export function AboutElement() {
  const { data: config } = useConfig();
  const [meta, setMeta] = useState<MetaResponse | null>(null);

  useEffect(() => {
    apiFetch('/api/meta')
      .then((r) => r.json())
      .then((d: MetaResponse) => setMeta(d))
      .catch(() => {
        /* keep null */
      });
  }, []);

  return (
    <>
      <div className="flex flex-col gap-2 text-[12.5px]">
        <Row label="claude4spec version" value={config?.appVersion ?? meta?.c4sVersion ?? '—'} />
        <Row label="Config schema" value={config ? `v${config.$schemaVersion}` : '—'} />
        <Row label="Project root" value={meta?.cwd ?? '—'} />
      </div>
    </>
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
