import React, { useMemo } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { clientPluginHost } from '../core/plugin-host/host.js';
import { CHIP_HREF_PREFIX, decodePayload, preprocessXmlChips } from './xml-chip-preprocess.js';
import { XmlChipDispatcher } from './XmlChipDispatcher.js';
import { ChatCodeBlock } from './ChatCodeBlock.js';

/**
 * Shared <Markdown> factory used by chat assistant text (BlockRenderer.tsx)
 * and the subagent summary panel (SubagentPanel.tsx). Single source of truth
 * for XML chip rendering (5 M19 core types + section_ref extension).
 *
 * Pipeline: preprocessXmlChips replaces XML tags with placeholder markdown
 * links before parsing; the `a` component override intercepts those hrefs and
 * routes to <XmlChipDispatcher />. Avoids rehype-raw (no <script> injection
 * vector) — malformed tags are dropped at the sanitization step.
 */
export function ChatMarkdown({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const activeTypes = useMemo(
    () => new Set(clientPluginHost.listEntities().map((m) => m.type)),
    [],
  );
  const processed = useMemo(() => preprocessXmlChips(text, activeTypes), [text, activeTypes]);

  return (
    <Markdown
      className={className}
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
      components={{
        pre({ children }) {
          return <>{children}</>;
        },
        code({ className: codeClass, children, ...props }) {
          const match = /language-(\w+)/.exec(codeClass || '');
          if (!match) {
            return (
              <code className={codeClass} {...props}>
                {children}
              </code>
            );
          }
          const rawCode = extractTextFromNode(children).replace(/\n$/, '');
          return (
            <ChatCodeBlock language={match[1] ?? ''} rawCode={rawCode}>
              {children}
            </ChatCodeBlock>
          );
        },
        a({ href, children, ...rest }) {
          if (typeof href === 'string' && href.startsWith(CHIP_HREF_PREFIX)) {
            const payload = href.slice(CHIP_HREF_PREFIX.length);
            const chip = decodePayload(payload);
            if (chip) return <XmlChipDispatcher chip={chip} />;
          }
          return (
            <a href={href} {...rest}>
              {children}
            </a>
          );
        },
      }}
    >
      {processed}
    </Markdown>
  );
}

function extractTextFromNode(node: React.ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractTextFromNode).join('');
  if (React.isValidElement(node)) {
    const props = node.props as { children?: React.ReactNode };
    return extractTextFromNode(props.children);
  }
  return '';
}
