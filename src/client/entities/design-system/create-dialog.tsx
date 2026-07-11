import { useState, type FormEvent } from 'react';
import { Dialog, FormShell, FormField, ActionButton } from '../../host-ui-kit/index.js';
import { useCreateDesignSystem } from '../../hooks/useDesignSystems.js';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (slug: string) => void;
}

export function DesignSystemCreateDialog({ open, onClose, onCreated }: Props) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const create = useCreateDesignSystem();

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) {
      setFormError('Name is required');
      return;
    }
    try {
      const ds = await create.mutateAsync({
        name: trimmed,
        description: description.trim() || undefined,
      });
      onCreated(ds.slug);
    } catch (err) {
      setFormError((err as Error).message ?? 'Failed to create design system');
    }
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void submit();
  }

  return (
    <Dialog open={open} onClose={onClose} size="sm" title="New design system">
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
            placeholder="Brand 2026"
            spellCheck={false}
            className="w-full text-[13.5px] outline-none px-2 py-1 rounded"
            style={{ color: 'var(--c-ink)', background: 'var(--c-panel)', border: '1px solid var(--c-hair)' }}
          />
        </FormField>
        <FormField label="Description">
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What this design system covers (optional)"
            className="w-full text-[12.5px] outline-none px-2 py-1 rounded"
            style={{ color: 'var(--c-ink)', background: 'var(--c-panel)', border: '1px solid var(--c-hair)' }}
          />
        </FormField>
      </FormShell>
    </Dialog>
  );
}
