import type { ReactNode } from 'react';
import { kv, mono } from './toolRenderers.js';

const ACTION_LABEL: Record<string, string> = {
  replace: 'replace',
  append: 'append',
  insert_after_section: 'insert',
};

interface Props {
  action: string;
  changeSummary: string | null;
  anchor: string | null;
  heading: string | null;
  content: string | null;
  newHash: string | null;
}

export function BriefUpdateCard({
  action,
  changeSummary,
  anchor,
  heading,
  content,
  newHash,
}: Props) {
  const label = ACTION_LABEL[action] ?? action;
  const text = content ?? '';
  const preview = text.length > 320 ? `${text.slice(0, 320)}…` : text;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {kv('Action', <ActionChip label={label} />)}
      {changeSummary ? kv('Summary', changeSummary) : null}
      {anchor ? kv('Anchor', mono(anchor)) : null}
      {heading ? kv('Heading', heading) : null}
      {preview ? kv('Body', <Preview text={preview} />) : null}
      {newHash
        ? kv(
            'Result',
            <span className="text-[12px]" style={{ color: 'var(--c-ink)' }}>
              Updated · hash {newHash.slice(0, 12)}…
            </span>,
          )
        : null}
    </div>
  );
}

function ActionChip({ label }: { label: string }): ReactNode {
  return (
    <span
      className="font-mono text-[11px] px-1.5 py-[1px] rounded-sm"
      style={{
        background: 'var(--c-panel)',
        border: '1px solid var(--c-hair)',
        color: 'var(--c-ink)',
      }}
    >
      {label}
    </span>
  );
}

function Preview({ text }: { text: string }): ReactNode {
  return (
    <pre
      className="font-mono text-[11.5px] scroll-thin"
      style={{
        background: 'var(--c-panel)',
        color: 'var(--c-ink)',
        padding: '6px 8px',
        borderRadius: 4,
        margin: 0,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        maxHeight: 160,
        overflow: 'auto',
      }}
    >
      {text}
    </pre>
  );
}
