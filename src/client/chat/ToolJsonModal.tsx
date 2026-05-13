import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export interface ToolJsonItem {
  toolName: string;
  input: unknown;
  result: unknown;
  isError: boolean;
}

interface Props {
  title: string;
  items: ToolJsonItem[];
  onClose: () => void;
}

export function ToolJsonModal({ title, items, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const isBatch = items.length > 1;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Raw JSON for ${title}`}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        zIndex: 1300,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: 'min(1100px, 100%)',
          maxHeight: 'calc(100vh - 48px)',
          background: 'var(--c-card)',
          border: '1px solid var(--c-hair-strong)',
          borderRadius: 8,
          boxShadow: '0 24px 64px rgba(0,0,0,0.28)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '12px 16px',
            borderBottom: '1px solid var(--c-hair)',
            background: 'var(--c-panel)',
          }}
        >
          <span
            className="font-mono"
            style={{ fontSize: 11.5, color: 'var(--c-subtle)', letterSpacing: '0.04em' }}
          >
            RAW JSON
          </span>
          <span
            className="font-mono"
            style={{ fontSize: 12.5, color: 'var(--c-ink)', flex: 1 }}
            title={title}
          >
            {title}
          </span>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 26,
              height: 26,
              borderRadius: 4,
              color: 'var(--c-muted)',
            }}
          >
            <X size={14} />
          </button>
        </div>

        <div
          style={{
            padding: 16,
            overflow: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 20,
          }}
        >
          {items.map((item, idx) => (
            <ItemBlock
              key={idx}
              item={item}
              indexLabel={isBatch ? `#${idx + 1}` : null}
            />
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ItemBlock({
  item,
  indexLabel,
}: {
  item: ToolJsonItem;
  indexLabel: string | null;
}) {
  const hasResult = item.result !== null && item.result !== undefined;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {indexLabel && (
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 8,
            paddingBottom: 6,
            borderBottom: '1px solid var(--c-hair)',
          }}
        >
          <span
            className="font-mono"
            style={{ fontSize: 11, color: 'var(--c-subtle)', letterSpacing: '0.06em' }}
          >
            {indexLabel}
          </span>
          <span
            className="font-mono"
            style={{ fontSize: 12, color: 'var(--c-ink)' }}
            title={item.toolName}
          >
            {item.toolName}
          </span>
        </div>
      )}
      <JsonSection label="Request" value={item.input} />
      {hasResult && (
        <JsonSection
          label="Response"
          value={item.result}
          tone={item.isError ? 'error' : 'success'}
        />
      )}
    </div>
  );
}

function JsonSection({
  label,
  value,
  tone,
}: {
  label: string;
  value: unknown;
  tone?: 'success' | 'error';
}) {
  const bg =
    tone === 'error'
      ? 'var(--c-red-soft)'
      : tone === 'success'
        ? 'var(--c-green-soft)'
        : 'var(--c-panel)';
  const border =
    tone === 'error'
      ? '1px solid var(--c-red)'
      : tone === 'success'
        ? '1px solid var(--c-green)'
        : '1px solid var(--c-hair)';
  return (
    <div>
      <div
        className="text-[10px] uppercase tracking-wider font-mono mb-1.5"
        style={{ color: 'var(--c-subtle)' }}
      >
        {label}
      </div>
      <pre
        className="rounded-md p-3 font-mono text-[11.5px] overflow-auto whitespace-pre-wrap break-all"
        style={{
          background: bg,
          color: 'var(--c-ink)',
          border,
          maxHeight: '60vh',
          margin: 0,
        }}
      >
        {safeStringify(value)}
      </pre>
    </div>
  );
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
