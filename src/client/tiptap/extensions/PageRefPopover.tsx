import { useEffect, useMemo, useRef, useState } from 'react';
import { FileText } from 'lucide-react';
import {
  FieldLabel,
  InlineError,
  PopoverFooter,
  PopoverShell,
  SelectInput,
  TextInput,
} from '../../ui/Popover.js';
import { usePageAutocomplete, usePageLinks } from '../../hooks/usePageLinks.js';
import type { PageRefSyntax } from './PageRefNode.js';

const PAGE_REF_POPOVER_EVENT = 'c4s:page-ref-popover-open';

export interface PageRefPopoverProps {
  syntax: PageRefSyntax;
  path: string;
  anchor?: string;
  label?: string;
  onSave: (attrs: { syntax: PageRefSyntax; path: string; anchor: string; label: string }) => void;
  onRemove: () => void;
}

interface PageRefPopoverRequest {
  x: number;
  y: number;
  props: PageRefPopoverProps;
  resolve: (ok: boolean) => void;
}

export function openPageRefPopover(
  position: { x: number; y: number },
  props: PageRefPopoverProps,
): Promise<boolean> {
  return new Promise((resolve) => {
    const detail: PageRefPopoverRequest = { x: position.x, y: position.y, props, resolve };
    window.dispatchEvent(new CustomEvent<PageRefPopoverRequest>(PAGE_REF_POPOVER_EVENT, { detail }));
  });
}

export function PageRefPopoverHost() {
  const [request, setRequest] = useState<PageRefPopoverRequest | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<PageRefPopoverRequest>).detail;
      setRequest((prev) => {
        if (prev) prev.resolve(false);
        return detail;
      });
    };
    window.addEventListener(PAGE_REF_POPOVER_EVENT, handler as EventListener);
    return () => window.removeEventListener(PAGE_REF_POPOVER_EVENT, handler as EventListener);
  }, []);

  if (!request) return null;

  const close = (ok: boolean) => {
    const r = request;
    setRequest(null);
    r.resolve(ok);
  };

  return <PageRefPopoverForm request={request} onClose={close} />;
}

const SYNTAX_OPTIONS: { value: PageRefSyntax; label: string }[] = [
  { value: 'at', label: '@path.md' },
  { value: 'backticks', label: '`path.md`' },
  { value: 'link', label: '[label](path.md)' },
];

function PageRefPopoverForm({
  request,
  onClose,
}: {
  request: PageRefPopoverRequest;
  onClose: (ok: boolean) => void;
}) {
  const { props } = request;
  const [path, setPath] = useState(props.path);
  const [anchor, setAnchor] = useState(props.anchor ?? '');
  const [label, setLabel] = useState(props.label ?? '');
  const [syntax, setSyntax] = useState<PageRefSyntax>(props.syntax);
  const [error, setError] = useState<string | null>(null);
  const firstRef = useRef<HTMLInputElement>(null);

  const autocomplete = usePageAutocomplete(path, 8);
  const suggestions = autocomplete.data?.suggestions ?? [];
  const pageLinks = usePageLinks();

  const anchorsForPath = useMemo(() => {
    // Anchor list is not yet exposed through /api/page-links; fall back to empty list (free-form input).
    return [] as string[];
  }, [pageLinks.data, path]);

  useEffect(() => {
    const t = window.setTimeout(() => firstRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, []);

  const submit = () => {
    setError(null);
    const p = path.trim();
    if (!p) {
      setError('Path is required');
      return;
    }
    props.onSave({
      syntax,
      path: p,
      anchor: anchor.trim(),
      label: syntax === 'link' ? label.trim() : '',
    });
    onClose(true);
  };

  const remove = () => {
    props.onRemove();
    onClose(true);
  };

  return (
    <PopoverShell
      x={request.x}
      y={request.y}
      width={320}
      estHeight={280}
      onCancel={() => onClose(false)}
      title="Edit page reference"
      icon={<FileText size={12} style={{ color: 'var(--c-accent)' }} />}
    >
      <FieldLabel>Path</FieldLabel>
      <TextInput
        ref={firstRef}
        value={path}
        onChange={(e) => {
          setPath(e.target.value);
          if (error) setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="modules/m05-chat-agent.md"
        style={{ fontFamily: 'ui-monospace, monospace' }}
      />
      {suggestions.length > 0 && path.length > 0 && path !== suggestions[0]?.path && (
        <div
          className="mt-1 rounded"
          style={{
            maxHeight: 140,
            overflowY: 'auto',
            border: '1px solid var(--c-hair)',
          }}
        >
          {suggestions.map((s) => (
            <button
              key={s.path}
              type="button"
              className="w-full text-left px-2 py-1 text-[12px]"
              style={{
                background: 'transparent',
                color: 'var(--c-ink)',
                fontFamily: 'ui-monospace, monospace',
              }}
              onClick={() => {
                setPath(s.path);
              }}
            >
              {s.path}
              {s.title && s.title !== s.path && (
                <span style={{ marginLeft: 6, color: 'var(--c-subtle)', fontFamily: 'inherit' }}>
                  · {s.title}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      <div style={{ marginTop: 8 }}>
        <FieldLabel>Anchor (optional)</FieldLabel>
        {anchorsForPath.length > 0 ? (
          <SelectInput value={anchor} onChange={(e) => setAnchor(e.target.value)}>
            <option value="">(none)</option>
            {anchorsForPath.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </SelectInput>
        ) : (
          <TextInput
            value={anchor}
            onChange={(e) => setAnchor(e.target.value)}
            placeholder="a7f3b2c1"
            style={{ fontFamily: 'ui-monospace, monospace' }}
          />
        )}
      </div>

      <div style={{ marginTop: 8 }}>
        <FieldLabel>Syntax</FieldLabel>
        <SelectInput value={syntax} onChange={(e) => setSyntax(e.target.value as PageRefSyntax)}>
          {SYNTAX_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </SelectInput>
      </div>

      {syntax === 'link' && (
        <div style={{ marginTop: 8 }}>
          <FieldLabel>Label</FieldLabel>
          <TextInput
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="page title"
          />
        </div>
      )}

      <InlineError message={error} />
      <PopoverFooter
        onCancel={() => onClose(false)}
        onSubmit={submit}
        submitLabel="Save"
        onRemove={remove}
      />
    </PopoverShell>
  );
}
