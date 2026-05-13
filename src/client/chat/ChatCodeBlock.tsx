import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

interface Props {
  language: string;
  rawCode: string;
  children: React.ReactNode;
}

export function ChatCodeBlock({ language, rawCode, children }: Props) {
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(rawCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* noop */
    }
  };

  return (
    <div
      className="my-2 rounded-md overflow-hidden"
      style={{ background: 'var(--c-panel)', border: '1px solid var(--c-hair)' }}
    >
      <div
        className="flex items-center gap-2 px-2.5 py-1"
        style={{ borderBottom: '1px solid var(--c-hair)' }}
      >
        <span
          className="font-mono text-[10px] uppercase tracking-wider"
          style={{ color: 'var(--c-subtle)' }}
        >
          {language || 'code'}
        </span>
        <span className="flex-1" />
        <button
          onClick={onCopy}
          className="inline-flex items-center gap-1 text-[10.5px] font-mono px-1.5 py-0.5 rounded btn-ghost"
          title="Copy"
        >
          {copied ? <Check size={10} /> : <Copy size={10} />}
          {copied ? 'copied' : 'copy'}
        </button>
      </div>
      <pre
        className="overflow-x-auto px-3 py-2 m-0"
        style={{ maxHeight: 384 }}
      >
        <code className={`hljs language-${language}`} style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>
          {children}
        </code>
      </pre>
    </div>
  );
}
