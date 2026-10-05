import React, { useMemo } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import '../xml-markup/host-renders.js';
import { clientPluginHost } from '../core/plugin-host/host.js';
import { CHIP_HREF_PREFIX, decodePayload, preprocessXmlChips } from './xml-chip-preprocess.js';
import { XmlChipDispatcher } from './XmlChipDispatcher.js';
import { ChatCodeBlock } from './ChatCodeBlock.js';
import { Link } from '@tanstack/react-router';
import { entityRouteHref } from './entityRouteHref.js';
import { decodePageRef, remarkPageRefs } from './remark-page-refs.js';
import { ChatPageRef, ChatPagesIndexContext, useChatPagesIndex } from './ChatPageRef.js';

/**
 * Shared <Markdown> factory used by chat assistant text, user messages
 * (2.1.7 — `UserText` with `pageRefs`, BlockRenderer.tsx) and the subagent
 * summary panel (SubagentPanel.tsx). The ONLY entry to react-markdown. Single source of truth
 * for XML chip rendering — every registered tag that targets an entity or a
 * section (M51), picked from the registry rather than from a list of names.
 *
 * Pipeline: preprocessXmlChips replaces XML tags with placeholder markdown
 * links before parsing; the `a` component override intercepts those hrefs and
 * routes to <XmlChipDispatcher />. Avoids rehype-raw (no <script> injection
 * vector) — malformed tags are dropped at the sanitization step.
 */
export function ChatMarkdown({
  text,
  className,
  pageRefs = false,
}: {
  text: string;
  className?: string;
  /**
   * 2.1.7 (M14) — recognise page references (`@path.md`, `` `path.md` ``,
   * `[label](path.md)`) as navigable chips, with newlines kept as line breaks:
   * the user-message rendering. Assistant text leaves it off.
   */
  pageRefs?: boolean;
}) {
  return pageRefs ? (
    <ChatMarkdownWithPageRefs text={text} className={className} />
  ) : (
    <ChatMarkdownBase text={text} className={className} />
  );
}

function ChatMarkdownWithPageRefs({ text, className }: { text: string; className?: string }) {
  const pagesIndex = useChatPagesIndex();
  return (
    <ChatPagesIndexContext.Provider value={pagesIndex}>
      <ChatMarkdownBase text={text} className={className} pagesIndex={pagesIndex} pageRefs />
    </ChatPagesIndexContext.Provider>
  );
}

function ChatMarkdownBase({
  text,
  className,
  pageRefs = false,
  pagesIndex,
}: {
  text: string;
  className?: string;
  pageRefs?: boolean;
  pagesIndex?: ReadonlyMap<string, unknown>;
}) {
  // A `type` the host does not know, or whose plugin is inactive, still
  // sanitizes and renders as the host's broken chip `[broken: slug]` (M05).
  const processed = useMemo(() => preprocessXmlChips(text), [text]);

  return (
    <Markdown
      className={className}
      remarkPlugins={pageRefs ? [remarkGfm, [remarkPageRefs, { index: pagesIndex, breaks: true }]] : [remarkGfm]}
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
        a: pageRefs ? ChipOrNewTabLink : ChipOrLink,
      }}
    >
      {processed}
    </Markdown>
  );
}

/**
 * The `components.a` override: a placeholder link minted by `preprocessXmlChips`
 * becomes the chip it encodes; a link to an entity route (0.2.110 M05) becomes a
 * router `<Link>` — client-side navigation, no reload; any other link stays a link.
 */
/**
 * A user message's links open in a new tab, as they did before the message
 * moved to `ChatMarkdown` — following one must not navigate away from the chat.
 */
function ChipOrNewTabLink(props: React.ComponentPropsWithoutRef<'a'>) {
  return <ChipOrLink {...props} newTab />;
}

function ChipOrLink({
  href,
  children,
  newTab = false,
  ...rest
}: React.ComponentPropsWithoutRef<'a'> & { newTab?: boolean }) {
  const pageRef = typeof href === 'string' ? decodePageRef(href) : null;
  if (pageRef) return <ChatPageRef refAttrs={pageRef} />;
  if (typeof href === 'string' && href.startsWith(CHIP_HREF_PREFIX)) {
    const payload = href.slice(CHIP_HREF_PREFIX.length);
    const chip = decodePayload(payload);
    if (chip) return <XmlChipDispatcher chip={chip} />;
  }
  if (typeof href === 'string') {
    const prefixes = clientPluginHost
      .listEntities()
      .map((m) => m.pathPrefix)
      .filter((p): p is string => !!p);
    const route = entityRouteHref(href, prefixes);
    if (route) {
      return (
        <Link
          to={route.to as never}
          search={route.search as never}
          hash={route.hash}
          className={rest.className}
          title={rest.title}
        >
          {children}
        </Link>
      );
    }
  }
  return (
    <a href={href} {...rest} {...(newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
      {children}
    </a>
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
