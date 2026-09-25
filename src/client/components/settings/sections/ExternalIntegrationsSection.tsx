import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../../lib/api-core.js';
import { toast } from '../../../ui/events.js';
import { SettingsCard } from '../SettingsCard.js';
import { SettingsCheckboxRow } from '../SettingsCheckboxRow.js';
import type { McpConfigResponse } from '../../../../shared/mcp-config.js';

interface ExternalSkillSummary {
  slug: string;
  name: string;
  description: string;
}

interface ExternalSkillsListResponse {
  skills: ExternalSkillSummary[];
  projectSlug: string | null;
}

/**
 * M26 §7 — "External Integrations" (0.2.93; was "External Skills", anchor
 * `#external-skills`). One card shell, two read-only export blocks:
 *
 *   - skills (M22) — unchanged since 0.1.104;
 *   - MCP connection config (M12) — rendered by the server per request.
 *
 * The shell owns the invariant: no Save button, and nothing in either block
 * mutates config.json. Sharing the card does not share ownership.
 */
export function ExternalIntegrationsSection() {
  return (
    <SettingsCard
      id="external-integrations"
      title="External Integrations"
      description="Connect AI coding agents working outside this app to the specification. Read-only export — nothing here changes the project config."
    >
      <div className="flex flex-col gap-5">
        <SkillsBlock />
        <McpConfigBlock />
      </div>
    </SettingsCard>
  );
}

function BlockHeading({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-2">
      <h3 className="text-[13px] font-semibold" style={{ color: 'var(--c-ink)' }}>
        {title}
      </h3>
      <p className="text-[11.5px] mt-0.5" style={{ color: 'var(--c-subtle)' }}>
        {description}
      </p>
    </div>
  );
}

/**
 * M22 skills block — metadata from GET /api/external-skills, a ZIP of the
 * checked subset from GET /api/external-skills/bundle. The CLI counterpart is
 * `c4s install-skills`.
 */
function SkillsBlock() {
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
    <div data-testid="external-integrations-skills">
      <BlockHeading
        title="Skills"
        description="Skills for AI coding agents working in a separate code repo (spec-reader, brief-implementer, refactor)."
      />
      <div className="flex flex-col gap-2">
        {!data ? (
          <p className="text-[12px]" style={{ color: 'var(--c-subtle)' }}>
            Loading…
          </p>
        ) : (
          data.skills.map((skill) => {
            const checked = selected.has(skill.slug);
            return (
              <SettingsCheckboxRow key={skill.slug} checked={checked} onChange={() => toggle(skill.slug)}>
                <span className="block text-[13px] font-medium font-mono" style={{ color: 'var(--c-ink)' }}>
                  {skill.name}
                </span>
                <span className="block text-[11.5px]" style={{ color: 'var(--c-subtle)' }}>
                  {skill.description}
                </span>
              </SettingsCheckboxRow>
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
            {downloading
              ? 'Preparing ZIP…'
              : data && selected.size < data.skills.length
                ? 'Download selected'
                : 'Download ZIP'}
          </button>
        </div>
        <p className="text-[11.5px] text-right" style={{ color: 'var(--c-subtle)' }} data-testid="skills-cli-hint">
          Same from the terminal:{' '}
          <code className="font-mono">c4s install-skills --project {data?.projectSlug ?? '<slug>'}</code>{' '}
          (writes directly to <code className="font-mono">.claude/skills</code>).
        </p>
      </div>
    </div>
  );
}

/**
 * M12 MCP block — three connection variants from
 * GET /api/projects/:id/_meta/mcp-config, one visible at a time. A pill SWAPS
 * the snippet; Copy puts the active snippet on the clipboard exactly as the
 * server sent it. The client interpolates nothing.
 */
function McpConfigBlock() {
  const { data, isError } = useQuery({
    queryKey: ['mcp-config'],
    queryFn: async () => {
      const res = await apiFetch('/api/_meta/mcp-config');
      if (!res.ok) throw new Error(`mcp-config failed (${res.status})`);
      return (await res.json()) as McpConfigResponse;
    },
  });
  const [activeId, setActiveId] = useState<string | null>(null);
  const variants = data?.variants ?? [];
  const active = variants.find((v) => v.id === activeId) ?? variants[0];

  async function handleCopy() {
    if (!active) return;
    try {
      await navigator.clipboard.writeText(active.snippet);
      toast.success('MCP config copied');
    } catch {
      toast.error('Copy failed');
    }
  }

  return (
    <div data-testid="external-integrations-mcp">
      <BlockHeading
        title="MCP connection"
        description="Add one of these entries to your MCP client's config. Filled in with this project's id and the workspace's default port — a server started on a one-off port serves the same project at that port instead."
      />
      {isError ? (
        <p className="text-[12px]" style={{ color: 'var(--c-subtle)' }}>
          Could not load the MCP config.
        </p>
      ) : !active ? (
        <p className="text-[12px]" style={{ color: 'var(--c-subtle)' }}>
          Loading…
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-1.5" role="tablist">
            {variants.map((v) => {
              const selected = v.id === active.id;
              return (
                <button
                  key={v.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  data-testid={`mcp-config-pill-${v.id}`}
                  onClick={() => setActiveId(v.id)}
                  className="rounded-full px-2.5 py-1 text-[11.5px] font-medium"
                  style={{
                    background: selected ? 'var(--c-accent)' : 'transparent',
                    color: selected ? '#fff' : 'var(--c-ink-soft)',
                    border: `1px solid ${selected ? 'var(--c-accent)' : 'var(--c-hair)'}`,
                  }}
                >
                  {v.label}
                </button>
              );
            })}
          </div>
          <pre
            data-testid="mcp-config-snippet"
            className="text-[11.5px] font-mono overflow-x-auto rounded-md px-3 py-2 m-0"
            style={{ background: 'var(--c-bg)', border: '1px solid var(--c-hair)', color: 'var(--c-ink)' }}
          >
            {active.snippet}
          </pre>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => void handleCopy()}
              className="rounded-md px-3 py-1.5 text-[12px] font-medium"
              style={{ background: 'var(--c-accent)', color: '#fff' }}
            >
              Copy
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
