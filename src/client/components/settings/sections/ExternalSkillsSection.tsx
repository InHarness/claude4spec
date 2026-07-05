import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../../lib/api-core.js';
import { toast } from '../../../ui/events.js';
import { SettingsCard } from '../SettingsCard.js';

interface ExternalSkillSummary {
  slug: string;
  name: string;
  description: string;
}

interface ExternalSkillsListResponse {
  skills: ExternalSkillSummary[];
}

/**
 * M26 §7 (0.1.104) — External Skills section. Read-only export surface for
 * the three on-demand skills (spec-reader, brief-implementer, refactor):
 * fetches metadata from GET /api/external-skills and downloads a ZIP from
 * GET /api/external-skills/bundle for the checked subset. No Save button,
 * no config.json mutation — the CLI counterpart is `c4s install-skills`.
 */
export function ExternalSkillsSection() {
  const { data } = useQuery({
    queryKey: ['external-skills'],
    queryFn: () => apiFetch('/api/external-skills').then((r) => r.json() as Promise<ExternalSkillsListResponse>),
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (data) setSelected(new Set(data.skills.map((s) => s.slug)));
  }, [data]);

  function toggle(slug: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  async function handleDownload() {
    if (selected.size === 0) return;
    setDownloading(true);
    try {
      const res = await apiFetch(`/api/external-skills/bundle?skills=${[...selected].join(',')}`);
      if (!res.ok) throw new Error(`download failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'external-skills.zip';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <SettingsCard
      id="external-skills"
      title="External Skills"
      description="Skills for AI coding agents working in a separate code repo (spec-reader, brief-implementer, refactor). Read-only export — for the CLI equivalent, see `c4s install-skills`."
    >
      <div className="flex flex-col gap-2">
        {!data ? (
          <p className="text-[12px]" style={{ color: 'var(--c-subtle)' }}>
            Loading…
          </p>
        ) : (
          data.skills.map((skill) => {
            const checked = selected.has(skill.slug);
            return (
              <label
                key={skill.slug}
                className="flex items-center gap-3 rounded-md px-3 py-2"
                style={{ background: 'var(--c-bg)', border: '1px solid var(--c-hair)' }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(skill.slug)}
                  className="h-4 w-4"
                />
                <span className="flex-1 min-w-0">
                  <span className="block text-[13px] font-medium font-mono" style={{ color: 'var(--c-ink)' }}>
                    {skill.name}
                  </span>
                  <span className="block text-[11.5px]" style={{ color: 'var(--c-subtle)' }}>
                    {skill.description}
                  </span>
                </span>
              </label>
            );
          })
        )}

        <div className="flex justify-end">
          <button
            type="button"
            disabled={!data || selected.size === 0 || downloading}
            onClick={() => void handleDownload()}
            className="rounded-md px-3 py-1.5 text-[12px] font-medium disabled:opacity-50"
            style={{ background: 'var(--c-accent)', color: '#fff' }}
          >
            {downloading ? 'Preparing ZIP…' : 'Download ZIP'}
          </button>
        </div>
      </div>
    </SettingsCard>
  );
}
