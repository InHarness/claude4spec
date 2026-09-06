/**
 * Render slot `renderOverlay` — the read-only surface a chip or card opens.
 *
 * REQUIRED, not optional: the host's slot rules refuse to register a hidden type
 * without it ("its chip has no detail route to open"). The brief names three
 * render slots and this is a fourth, because a hidden type with a clickable chip
 * and nowhere for the click to go is not a shape the host will accept.
 *
 * Read-only by design and not merely by omission. An edge is authored in a
 * workflow step, not while reading a page, so this surface offers no edit
 * affordance at all — there is no popover and no slash command for this type
 * either, for the same reason.
 *
 * ONE entrance, and it always fetches. `EntityOverlayHost` is the only thing that
 * mounts this slot and it passes `{ slug, caption, onClose }` — the slot type
 * carries no `entity` prop at all, so there is no "the caller already has the
 * record" path to take. The refetch is one bounded `GET`: nothing here is
 * `contentBearing`, so the record arrives whole.
 */

import React from 'react';
import { X } from 'lucide-react';
import { FieldGrid, FieldRow, LoadingState } from '@c4s/plugin-runtime/ui';
import { DependencySentence } from './sentence.js';
import { fetchModuleDependency, type ModuleDependency } from './types.js';

export function ModuleDependencyOverlay({
  slug,
  caption,
  onClose,
}: {
  slug: string;
  caption?: string;
  onClose: () => void;
}) {
  const [record, setRecord] = React.useState<ModuleDependency | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let live = true;
    setLoading(true);
    void fetchModuleDependency(slug).then((next) => {
      if (!live) return;
      setRecord(next);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [slug]);

  return (
    <div
      data-testid="module-dependency-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-[560px] rounded-lg p-5"
        style={{ background: 'var(--c-bg)', border: '1px solid var(--c-hair)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          {loading ? (
            <LoadingState lines={1} width={200} />
          ) : record ? (
            <DependencySentence dependent={record.dependent} provider={record.provider} small={false} />
          ) : (
            <span className="text-[13px]" style={{ color: 'var(--c-red)' }}>
              {`broken module-dependency: ${slug}`}
            </span>
          )}
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            style={{ color: 'var(--c-muted)' }}
          >
            <X size={16} />
          </button>
        </div>

        {record ? (
          <div className="mt-4">
            <FieldGrid>
              <FieldRow label="Needs" align="start">
                <span className="text-[13px]" style={{ color: 'var(--c-ink)' }}>
                  {record.needs}
                </span>
              </FieldRow>
            </FieldGrid>
            {caption ? (
              <div className="mt-3 text-[12px] italic" style={{ color: 'var(--c-muted)' }}>
                {caption}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
