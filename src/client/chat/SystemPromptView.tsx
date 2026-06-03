import React from 'react';
import { Copy, FileText, Loader2 } from 'lucide-react';
import hljs from 'highlight.js/lib/core';
import xml from 'highlight.js/lib/languages/xml';
import { toast } from '../ui/events.js';

hljs.registerLanguage('xml', xml);

interface SystemPromptViewProps {
  prompt: string | null | undefined;
  loading: boolean;
}

export function SystemPromptView({ prompt, loading }: SystemPromptViewProps) {
  const highlighted = React.useMemo(
    () => (prompt ? hljs.highlight(prompt, { language: 'xml' }).value : ''),
    [prompt],
  );

  if (loading) {
    return (
      <div
        role="region"
        aria-label="System prompt"
        className="flex items-center gap-2 px-3 py-6 text-[12.5px]"
        style={{ color: 'var(--c-muted)' }}
      >
        <Loader2 size={14} className="animate-spin" />
        <span>Loading system prompt...</span>
      </div>
    );
  }

  if (prompt == null) {
    return (
      <div
        role="region"
        aria-label="System prompt"
        className="flex flex-col items-center gap-2 px-3 py-10 text-center"
        style={{ color: 'var(--c-muted)' }}
      >
        <FileText size={28} style={{ opacity: 0.4 }} />
        <div className="text-[12.5px]">
          System prompt will be rendered after the first message.
        </div>
      </div>
    );
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      toast.success('System prompt copied');
    } catch {
      toast.error('Failed to copy');
    }
  };

  return (
    <div role="region" aria-label="System prompt">
      <div
        className="flex items-center gap-2 px-2 py-1.5"
        style={{ background: 'var(--c-panel)', borderBottom: '1px solid var(--c-hair)' }}
      >
        <FileText size={11} style={{ color: 'var(--c-accent)' }} />
        <span
          className="flex-1 text-[10.5px] font-mono uppercase tracking-wider"
          style={{ color: 'var(--c-subtle)' }}
        >
          System prompt
        </span>
        <button
          onClick={() => void handleCopy()}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-mono btn-ghost"
          style={{ color: 'var(--c-muted)' }}
          title="Copy system prompt"
        >
          <Copy size={11} />
          <span>Copy</span>
        </button>
      </div>
      <pre
        className="m-0"
        style={{
          padding: 0,
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 12,
          lineHeight: 1.55,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        <code
          className="hljs language-xml"
          style={{ display: 'block', padding: '10px 12px' }}
          dangerouslySetInnerHTML={{ __html: highlighted }}
        />
      </pre>
    </div>
  );
}
