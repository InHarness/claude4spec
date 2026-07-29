/**
 * `/endpoint` — the plugin-rendered slash-create popover. See the dto sibling
 * and `frontend-kit/slash-create.tsx` for the protocol.
 */

import { useEffect, useRef, useState } from 'react';
import { ArrowRightLeft } from 'lucide-react';
import {
  FieldLabel,
  InlineError,
  PopoverFooter,
  SelectInput,
  TextInput,
} from '../../../frontend-kit/popover-form.js';
import {
  SlashPopoverShell,
  type CaretCoords,
  insertEmbed,
  mountSlashCreatePopover,
  useSlashSubmit,
  type EmbedEditor,
} from '../../../frontend-kit/slash-create.js';
import { toast } from '../../../frontend-kit/host-events.js';
import { ENDPOINT_POPOVER_KIND, ENDPOINT_TYPE } from '../../../identity.js';
import type { HttpMethod } from '../../../types.js';
import { endpointsApi } from './api.js';

export { ENDPOINT_POPOVER_KIND };

const HTTP_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

export function EndpointSlashCreatePopover({
  editor,
  coords,
  onClose,
}: {
  editor: EmbedEditor;
  coords: CaretCoords | null;
  onClose: () => void;
}) {
  const [method, setMethod] = useState<HttpMethod>('GET');
  const [path, setPath] = useState('/api/');
  const [summary, setSummary] = useState('');
  const [pathError, setPathError] = useState<string | null>(null);
  const pathRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = window.setTimeout(() => {
      pathRef.current?.focus();
      pathRef.current?.select();
    }, 0);
    return () => window.clearTimeout(t);
  }, []);

  const { error, busy, submit } = useSlashSubmit(async () => {
    const ep = await endpointsApi.create({
      method,
      path: path.trim(),
      ...(summary.trim() ? { summary: summary.trim() } : {}),
    });
    insertEmbed(editor, ENDPOINT_TYPE, ep.slug);
    toast.success(`Endpoint ${ep.method} ${ep.path} created`);
    onClose();
    return ep;
  });

  const onSubmit = () => {
    const trimmed = path.trim();
    if (!trimmed) {
      setPathError('Path is required');
      return;
    }
    if (!trimmed.startsWith('/')) {
      setPathError('Path must start with /');
      return;
    }
    void submit();
  };

  return (
    <SlashPopoverShell
      width={360}
      title="New endpoint"
      coords={coords}
      icon={<ArrowRightLeft size={12} style={{ color: 'var(--c-accent)' }} />}
      onCancel={onClose}
    >
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <div style={{ width: 100 }}>
          <FieldLabel>Method</FieldLabel>
          <SelectInput value={method} onChange={(e) => setMethod(e.target.value as HttpMethod)}>
            {HTTP_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </SelectInput>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <FieldLabel>Path</FieldLabel>
          <TextInput
            ref={pathRef}
            value={path}
            onChange={(e) => {
              setPath(e.target.value);
              if (pathError) setPathError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onSubmit();
              }
            }}
            placeholder="/api/users"
            style={{ fontFamily: 'ui-monospace, monospace' }}
          />
        </div>
      </div>
      <FieldLabel>Summary (optional)</FieldLabel>
      <TextInput
        value={summary}
        onChange={(e) => setSummary(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onSubmit();
          }
        }}
        placeholder="List all users"
      />
      <InlineError message={pathError ?? error} />
      <PopoverFooter onCancel={onClose} onSubmit={onSubmit} submitLabel="Create" busy={busy} />
    </SlashPopoverShell>
  );
}

export const mountEndpointSlashCreate = () =>
  mountSlashCreatePopover(ENDPOINT_POPOVER_KIND, EndpointSlashCreatePopover);
