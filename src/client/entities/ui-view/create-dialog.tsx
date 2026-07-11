import { useState, type FormEvent } from 'react';
import { Dialog, FormShell, FormField, ActionButton } from '../../host-ui-kit/index.js';
import { useCreateUiView } from '../../hooks/useUiViews.js';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (slug: string) => void;
}

export function UiViewCreateDialog({ open, onClose, onCreated }: Props) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const create = useCreateUiView();

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) {
      setFormError('Name is required');
      return;
    }
    try {
      const view = await create.mutateAsync({
        name: trimmed,
        url: url.trim() || null,
        description: description.trim() || undefined,
      });
      onCreated(view.slug);
    } catch (err) {
      setFormError((err as Error).message ?? 'Failed to create view');
    }
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void submit();
  }

  return (
    <Dialog open={open} onClose={onClose} size="sm" title="New UI view">
      <FormShell
        onSubmit={handleSubmit}
        busy={create.isPending}
        error={formError}
        actions={
          <>
            <ActionButton variant="ghost" label="Cancel" onClick={onClose} />
            <ActionButton
              variant="primary"
              label={create.isPending ? 'Creating…' : 'Create'}
              onClick={() => void submit()}
              disabled={create.isPending}
            />
          </>
        }
      >
        <FormField label="Name">
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (formError) setFormError(null);
            }}
            autoFocus
            placeholder="User Profile Screen"
            spellCheck={false}
            className="w-full text-[13.5px] outline-none px-2 py-1 rounded"
            style={{ color: 'var(--c-ink)', background: 'var(--c-panel)', border: '1px solid var(--c-hair)' }}
          />
        </FormField>
        <FormField label="URL">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="/users/:id (empty = modal/drawer)"
            spellCheck={false}
            className="w-full font-mono text-[12.5px] outline-none px-2 py-1 rounded"
            style={{ color: 'var(--c-ink)', background: 'var(--c-panel)', border: '1px solid var(--c-hair)' }}
          />
        </FormField>
        <FormField label="Description">
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What this screen does (optional)"
            className="w-full text-[12.5px] outline-none px-2 py-1 rounded"
            style={{ color: 'var(--c-ink)', background: 'var(--c-panel)', border: '1px solid var(--c-hair)' }}
          />
        </FormField>
      </FormShell>
    </Dialog>
  );
}
