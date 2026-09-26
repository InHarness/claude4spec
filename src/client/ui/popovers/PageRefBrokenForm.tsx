import { useState } from 'react';
import { FilePlus } from 'lucide-react';
import { InlineError, PopoverShell, type PopoverFormProps } from '../Popover.js';
import { useCreatePage } from '../../hooks/usePage.js';
import { canCreatePage, deriveTitle } from '../../lib/newPage.js';

/**
 * 0.2.110 M14 — the popover of a BROKEN `@path` chip, two branches:
 *
 * - "Create file" creates the missing page at the chip's candidate path in the
 *   chip's root (the chip then resolves on the next `pageLinks:changed`);
 * - "Fix path" hands over to the `page-ref` edit popover.
 */
export function PageRefBrokenForm({ request, onClose }: PopoverFormProps<'page-ref-broken'>) {
  const { rootId, candidatePath } = request.props;
  const createPage = useCreatePage();
  // Same rule as the links list: only a `.md` path can be created as a page.
  const creatable = !!candidatePath && canCreatePage(candidatePath);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (!creatable) return;
    setError(null);
    try {
      await createPage.mutateAsync({ rootId, path: candidatePath, content: `# ${deriveTitle(candidatePath)}\n\n` });
      onClose({ action: 'created', path: candidatePath });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <PopoverShell
      x={request.x}
      y={request.y}
      width={300}
      onCancel={() => onClose(null)}
      title="Create file?"
      icon={<FilePlus size={12} style={{ color: 'var(--c-red, #c45a3b)' }} />}
    >
      <div className="text-[12.5px]" style={{ color: 'var(--c-muted)', lineHeight: 1.5 }}>
        {candidatePath ? (
          <>
            <code className="font-mono" style={{ color: 'var(--c-ink)' }}>
              {candidatePath}
            </code>{' '}
            {creatable ? 'does not exist.' : 'does not exist and is not a page (.md) path.'}
          </>
        ) : (
          'This path points outside the page root.'
        )}
      </div>
      <InlineError message={error} />
      <div className="flex items-center justify-end gap-2 mt-3">
        <button
          type="button"
          onClick={() => onClose({ action: 'fix' })}
          className="rounded-md px-3 py-1 text-[12px]"
          style={{ color: 'var(--c-muted)', border: '1px solid var(--c-hair)' }}
        >
          Fix path
        </button>
        <button
          type="button"
          autoFocus
          disabled={!creatable || createPage.isPending}
          onClick={() => void create()}
          className="rounded-md px-3 py-1 text-[12px] font-medium disabled:opacity-50"
          style={{ background: 'var(--c-accent)', color: '#fff' }}
        >
          {createPage.isPending ? 'Creating…' : 'Create file'}
        </button>
      </div>
    </PopoverShell>
  );
}
