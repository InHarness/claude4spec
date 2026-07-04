import { useState } from 'react';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { withStability } from '../stability.js';
import { Dialog } from '../overlay/Dialog.js';
import { ActionButton } from '../actions/ActionButton.js';

/**
 * `EntityDetailToolbar` (Panel detalu, `experimental`) — back-navigation +
 * destructive-confirm shell for an entity detail view. Does NOT perform the
 * delete itself: confirming calls `onDelete`, and the plugin author's
 * callback owns the actual mutation.
 */
export interface EntityDetailToolbarProps {
  title: string;
  onBack?(): void;
  onDelete?(): void;
  /** Entities that would be left dangling by the delete — surfaced in the confirm dialog. */
  brokenRefs?: { type: string; slug: string }[];
  busy?: boolean;
}

function EntityDetailToolbarImpl({ title, onBack, onDelete, brokenRefs, busy }: EntityDetailToolbarProps) {
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      <div className="flex items-center gap-2 px-5 py-2.5" style={{ borderBottom: '1px solid var(--c-hair)' }}>
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className="rounded-md p-1 btn-ghost"
            style={{ color: 'var(--c-muted)' }}
          >
            <ArrowLeft size={16} />
          </button>
        )}
        <div className="text-[14px] font-semibold truncate" style={{ color: 'var(--c-ink)' }}>
          {title}
        </div>
        <span className="flex-1" />
        {onDelete && (
          <ActionButton
            label="Delete"
            icon={<Trash2 size={13} />}
            variant="ghost"
            disabled={busy}
            onClick={() => setConfirming(true)}
          />
        )}
      </div>
      {onDelete && (
        <Dialog
          open={confirming}
          onClose={() => setConfirming(false)}
          title="Delete this entity?"
          size="sm"
          footer={
            <>
              <ActionButton label="Cancel" variant="secondary" onClick={() => setConfirming(false)} />
              <ActionButton
                label="Delete"
                variant="primary"
                disabled={busy}
                onClick={() => {
                  setConfirming(false);
                  onDelete();
                }}
              />
            </>
          }
        >
          <p className="text-[12.5px]" style={{ color: 'var(--c-ink)' }}>
            This action cannot be undone.
          </p>
          {brokenRefs && brokenRefs.length > 0 && (
            <div
              className="mt-3 rounded-md px-3 py-2 text-[12px]"
              style={{
                background: 'var(--c-red-soft, rgba(196,90,59,0.14))',
                color: 'var(--c-red, #c45a3b)',
                border: '1px solid var(--c-red, #c45a3b)',
              }}
            >
              <div className="font-medium mb-1">
                {brokenRefs.length} reference{brokenRefs.length === 1 ? '' : 's'} will break:
              </div>
              <ul className="list-disc pl-4">
                {brokenRefs.map((ref) => (
                  <li key={`${ref.type}/${ref.slug}`}>
                    {ref.type}/{ref.slug}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Dialog>
      )}
    </>
  );
}

export const EntityDetailToolbar = withStability(EntityDetailToolbarImpl, 'experimental');
