/**
 * The plugin side of a slash command's EXECUTION half.
 *
 * How the host wires it (M33, `client/tiptap/slashInvoke.ts`): a declarative
 * plugin command carries a `pluginPopoverKind`; invoking it dispatches a
 * `c4s:plugin-command` window event carrying `{ popoverKind, commandId, editor }`
 * and then does nothing more. Everything after that is the plugin's — render a
 * popover, create the entity, insert the embed.
 *
 * Before 0.2.2 `/endpoint` and `/dto` were two hardcoded cases inside
 * `slashInvoke.ts`, calling the host's own popover registry. This is the same
 * flow expressed through the door every other plugin uses.
 *
 * HOST GAP: neither the event name nor the embed node name is exported by
 * `@c4s/plugin-runtime`; both are mirrored from the host source and pinned by a
 * test. Filed as a patch.
 */

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

export const PLUGIN_COMMAND_EVENT = 'c4s:plugin-command';

/** The Tiptap node a slash-create inserts: the generic entity embed. */
export const EMBED_NODE = 'single_element';

/** Structural view of the editor the host hands over; `@tiptap/core` stays loose. */
export interface EmbedEditor {
  chain: () => { focus: () => { insertContent: (content: unknown) => { run: () => void } } };
}

export function insertEmbed(editor: EmbedEditor, type: string, slug: string): void {
  editor.chain().focus().insertContent({ type: EMBED_NODE, attrs: { type, slug } }).run();
}

/** Listen for one popover kind. Returns an unsubscribe. */
export function subscribeToSlashCreate(
  kind: string,
  onInvoke: (editor: EmbedEditor) => void,
): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const handler = (ev: Event) => {
    const detail = (ev as CustomEvent).detail as { popoverKind?: string; editor?: EmbedEditor };
    if (detail?.popoverKind !== kind || !detail.editor) return;
    onInvoke(detail.editor);
  };
  window.addEventListener(PLUGIN_COMMAND_EVENT, handler);
  return () => window.removeEventListener(PLUGIN_COMMAND_EVENT, handler);
}

const SHELL_STYLE: CSSProperties = {
  position: 'fixed',
  zIndex: 1200,
  padding: 10,
  borderRadius: 8,
  border: '1px solid var(--c-hair)',
  background: 'var(--c-panel)',
  color: 'var(--c-ink)',
  boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
};

/**
 * The popover frame. Deliberately NOT the kit's `Dialog` — that is the create
 * MODAL, a different surface; a slash-create is a light anchored popover, and
 * this reproduces the host shell the two forms used to sit in.
 */
export function SlashPopoverShell({
  width,
  title,
  icon,
  onCancel,
  children,
}: {
  width: number;
  title: string;
  icon?: ReactNode;
  onCancel: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onCancel();
    };
    window.addEventListener('keydown', onKey);
    // `mousedown` on the next frame, so the click that opened this popover does
    // not immediately close it.
    const t = window.setTimeout(() => window.addEventListener('mousedown', onDown), 0);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [onCancel]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={title}
      style={{ ...SHELL_STYLE, width, left: '50%', top: 120, transform: 'translateX(-50%)' }}
    >
      <div
        className="flex items-center gap-1.5 mb-2 text-[11px] uppercase tracking-wider font-mono"
        style={{ color: 'var(--c-subtle)' }}
      >
        {icon}
        {title}
      </div>
      {children}
    </div>
  );
}

/**
 * Mount a slash-create popover for one kind. Returns an unmount.
 *
 * React, the query client and `react-dom/client` are imported lazily so nothing
 * is pulled in until the user actually invokes the command.
 */
export function mountSlashCreatePopover(
  kind: string,
  Component: (props: { editor: EmbedEditor; onClose: () => void }) => ReactNode,
): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => undefined;

  let host: HTMLElement | null = null;
  let root: { render: (node: unknown) => void; unmount: () => void } | null = null;
  const close = () => root?.render(null);

  const unsubscribe = subscribeToSlashCreate(kind, (editor) => {
    void (async () => {
      const [{ createRoot }, runtime, { QueryClientProvider }, { createElement }] = await Promise.all([
        import('react-dom/client'),
        import('@c4s/plugin-runtime') as Promise<{ queryClient: unknown }>,
        import('@tanstack/react-query'),
        import('react'),
      ]);
      if (!host) {
        host = document.createElement('div');
        host.dataset.plugin = kind;
        document.body.appendChild(host);
      }
      root ??= createRoot(host) as unknown as typeof root;
      root!.render(
        createElement(
          QueryClientProvider,
          { client: runtime.queryClient as never },
          createElement(Component as never, { editor, onClose: close }),
        ),
      );
    })();
  });

  return () => {
    unsubscribe();
    root?.unmount();
    host?.remove();
  };
}

/** Shared local state for the two forms: a submit that reports its own error. */
export function useSlashSubmit<T>(run: () => Promise<T>) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (busy) return null;
    setBusy(true);
    try {
      return await run();
    } catch (err) {
      setError((err as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  };
  return { error, setError, busy, submit };
}
