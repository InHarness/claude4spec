import { ArrowLeft, Trash2 } from 'lucide-react';
import { withStability } from '../stability.js';
import { ActionButton } from '../actions/ActionButton.js';

/**
 * `EntityDetailToolbar` (Panel detalu, `experimental`, record
 * `entity-detail-toolbar`) — the back + delete shell of an entity detail view,
 * not host-wired. A click on delete calls `onDelete` straight away, with no
 * dialog in between: confirming the delete (with the warning about references
 * it will break) is the consumer's job, through the shell's
 * `confirmDestructive` facade (m13ui000). The toolbar mutates nothing itself.
 *
 * 2.1.28: the toolbar's own confirm dialog and its `brokenRefs` prop are gone —
 * both belong to the consumer's `confirmDestructive` call.
 */
export interface EntityDetailToolbarProps {
  title: string;
  onBack?(): void;
  onDelete?(): void;
  busy?: boolean;
}

function EntityDetailToolbarImpl({ title, onBack, onDelete, busy }: EntityDetailToolbarProps) {
  return (
    <div className="flex items-center gap-2 px-5 py-2.5" style={{ borderBottom: '1px solid var(--c-hair)' }}>
      {onBack && (
        <button
          type="button"
          onClick={() => onBack()}
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
        <ActionButton label="Delete" icon={<Trash2 size={13} />} variant="ghost" disabled={busy} onClick={() => onDelete()} />
      )}
    </div>
  );
}

export const EntityDetailToolbar = withStability(EntityDetailToolbarImpl, 'experimental');
