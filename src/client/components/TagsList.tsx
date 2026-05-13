import { Tag as TagIcon } from 'lucide-react';
import { useTags } from '../hooks/useTags.js';
import { clientPluginHost } from '../core/plugin-host/host.js';

export function TagsList() {
  const { data: tags = [], isLoading } = useTags();
  const modules = clientPluginHost.listEntities();

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <div
        className="flex items-center gap-3 px-8 py-4"
        style={{ borderBottom: '1px solid var(--c-hair)' }}
      >
        <TagIcon size={18} style={{ color: 'var(--c-accent)' }} />
        <h2 className="text-[18px] font-semibold tracking-tight" style={{ color: 'var(--c-ink)' }}>
          Tags
        </h2>
        <span className="font-mono text-[11.5px]" style={{ color: 'var(--c-subtle)' }}>
          {tags.length} {tags.length === 1 ? 'tag' : 'tags'}
        </span>
      </div>

      <div className="flex-1 overflow-auto nice-scroll">
        <div className="mx-auto" style={{ maxWidth: 720, padding: '24px 32px 48px' }}>
          {isLoading && (
            <div className="text-center text-[13px] py-10" style={{ color: 'var(--c-subtle)' }}>
              Loading…
            </div>
          )}
          {!isLoading && tags.length === 0 && (
            <div
              className="text-center py-20 rounded-lg"
              style={{
                background: 'var(--c-card)',
                border: '1px dashed var(--c-hair-strong)',
                color: 'var(--c-subtle)',
              }}
            >
              <div className="text-[14px]">No tags yet.</div>
              <div className="text-[12px] mt-1">
                Tags auto-create when you add them to an endpoint.
              </div>
            </div>
          )}
          <div className="space-y-1">
            {tags.map((t) => (
              <div
                key={t.slug}
                className="flex items-center gap-3 px-4 py-3 rounded-md"
                style={{ background: 'var(--c-card)', border: '1px solid var(--c-hair)' }}
              >
                <span
                  className="rounded-full"
                  style={{
                    width: 14,
                    height: 14,
                    background: t.color ?? 'var(--c-muted)',
                  }}
                />
                <span className="text-[14px] font-medium" style={{ color: 'var(--c-ink)' }}>
                  {t.name}
                </span>
                <span
                  className="font-mono text-[11px] px-1.5 py-0.5 rounded"
                  style={{ background: 'var(--c-panel)', color: 'var(--c-muted)' }}
                >
                  {t.slug}
                </span>
                <span className="flex-1" />
                <span
                  className="font-mono text-[11px]"
                  style={{ color: 'var(--c-subtle)' }}
                >
                  {modules
                    .map((m) => {
                      const c = t.counts[m.type] ?? 0;
                      const noun = c === 1 ? m.label : m.labelPlural;
                      return `${c} ${noun}`;
                    })
                    .join(' · ')}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
