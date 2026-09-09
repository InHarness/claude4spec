import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Monitor } from 'lucide-react';
import { designSystemsApi } from '../../design-system/frontend/api.js';
import { useUpdateUiView } from './hooks.js';
import { apiFetch, handle } from '../../../frontend-kit/api-core.js';
import { toast } from '../../../frontend-kit/host-events.js';
import {
  FieldLabel,
  InlineError,
  PopoverFooter,
  TextInput,
} from '../../../frontend-kit/popover-form.js';
import { SlashPopoverShell, useSlashSubmit } from '../../../frontend-kit/slash-create.js';
import type { UiView } from '../../../types.js';

/**
 * 0.2.78 — the `ui-view` edit popover, opened with Alt+click on a chip or card.
 *
 * ## What is editable here, and what deliberately is not
 *
 * Five fields: `Name` (required), `URL`, `Description`, `Design System` and
 * `Tags`. Parameters and `mockupHtml` are absent BY DESIGN, and the omission is
 * the interesting half of the design.
 *
 * A popover is a glance-sized surface: it exists so an author can correct a
 * title or re-point a design system without leaving the page they are writing.
 * `params[]` is a repeating structure whose entries have their own location
 * semantics, and `mockupHtml` is a document — frequently multi-megabyte, and the
 * thing a preview renders. Neither fits a 320px panel, and offering them here
 * badly would make the detail panel look like the fallback rather than the home.
 * They stay where the space to edit them is.
 *
 * ## One request, whole-value fields
 *
 * The submit is a single `PATCH /api/ui-views/{slug}`. `tags` travels as the
 * WHOLE list rather than as an add/remove pair, which is what the endpoint
 * declares — the server diffs it against what is stored, so this form never has
 * to know what the previous set was to describe a change to it.
 *
 * Renaming regenerates the slug server-side; the caller is told the new one so a
 * chip embedded in a page can re-point itself instead of going broken. A slug
 * collision comes back 409 and is shown inline, next to the field that caused
 * it, rather than as a toast that outlives the form.
 */

interface Draft {
  title: string;
  url: string;
  description: string;
  designSystemSlug: string;
  tags: string[];
}

/** `None` is a real choice, not the absence of one — see the field below. */
const NO_DESIGN_SYSTEM = '';

function UiViewEditForm({
  entity,
  onClose,
  onSaved,
}: {
  entity: UiView;
  onClose: () => void;
  onSaved?: (updated: UiView) => void;
}) {
  const update = useUpdateUiView();
  const [draft, setDraft] = useState<Draft>({
    title: entity.title,
    url: entity.url ?? '',
    description: entity.description ?? '',
    designSystemSlug: entity.designSystemSlug ?? NO_DESIGN_SYSTEM,
    tags: entity.tags ?? [],
  });
  const [designSystems, setDesignSystems] = useState<Array<{ slug: string; title: string }>>([]);
  const [knownTags, setKnownTags] = useState<string[]>([]);
  const titleRef = useRef<HTMLInputElement>(null);

  /**
   * Both lists are fetched once, on open, and a failure is SILENT.
   *
   * They feed autocomplete, not validation: `designSystemSlug` accepts a
   * dangling value by contract (a view may name a design system that has not
   * been created yet), and a tag the author types is created by the write. So a
   * list that failed to load costs the author a suggestion, never the edit —
   * blocking the form on it would be the picker holding the entity hostage.
   */
  useEffect(() => {
    let live = true;
    void designSystemsApi
      .list({ limit: 200 })
      .then((rows) => live && setDesignSystems(rows.map((r) => ({ slug: r.slug, title: r.title }))))
      .catch(() => undefined);
    void apiFetch('/api/tags')
      .then((res) => handle<{ tags: Array<{ slug: string }> }>(res))
      .then((body) => live && setKnownTags(body.tags.map((t) => t.slug)))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    titleRef.current?.focus();
    titleRef.current?.select();
  }, []);

  const { error, setError, busy, submit } = useSlashSubmit(async () => {
    const title = draft.title.trim();
    if (!title) throw new Error('Name is required');
    const updated = await update.mutateAsync({
      slug: entity.slug,
      input: {
        title,
        /**
         * `null` clears, `undefined` would mean "unchanged". An author who
         * empties the URL field means to remove it, so an empty string has to
         * become an explicit clear — sending `''` would store an empty URL,
         * which renders as a present-but-blank badge and is not what emptying a
         * field means.
         */
        url: draft.url.trim() || null,
        description: draft.description.trim() || null,
        designSystemSlug: draft.designSystemSlug || null,
        tags: draft.tags,
      },
    });
    return updated;
  });

  const tagText = useMemo(() => draft.tags.join(', '), [draft.tags]);

  const save = async () => {
    const updated = await submit();
    if (!updated) return;
    onSaved?.(updated);
    toast.success(`View “${updated.title}” updated`);
    onClose();
  };

  return (
    <SlashPopoverShell
      width={320}
      title="Edit UI view"
      icon={<Monitor size={12} />}
      coords={null}
      onCancel={onClose}
    >
      <div className="flex flex-col gap-2">
        <div>
          <FieldLabel>Name</FieldLabel>
          <TextInput
            ref={titleRef}
            value={draft.title}
            onChange={(e) => {
              setDraft((d) => ({ ...d, title: e.target.value }));
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void save();
            }}
            aria-label="Name"
          />
        </div>

        <div>
          <FieldLabel>URL</FieldLabel>
          <TextInput
            value={draft.url}
            onChange={(e) => setDraft((d) => ({ ...d, url: e.target.value }))}
            placeholder="/settings/profile"
            aria-label="URL"
          />
        </div>

        <div>
          <FieldLabel>Description</FieldLabel>
          <TextInput
            value={draft.description}
            onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
            aria-label="Description"
          />
        </div>

        <div>
          <FieldLabel>Design System</FieldLabel>
          {/*
           * A `<datalist>` over a free input rather than a `<select>`: the field
           * accepts a slug that does not resolve yet — the preview degrades to
           * the bare reset and says so in a comment — so a closed control would
           * be lying about the contract. "None" is spelled by emptying it, which
           * is why the placeholder says so rather than a phantom first option.
           */}
          <TextInput
            list="c4s-ui-view-design-systems"
            value={draft.designSystemSlug}
            onChange={(e) => setDraft((d) => ({ ...d, designSystemSlug: e.target.value }))}
            placeholder="None"
            aria-label="Design System"
          />
          <datalist id="c4s-ui-view-design-systems">
            {designSystems.map((ds) => (
              <option key={ds.slug} value={ds.slug}>
                {ds.title}
              </option>
            ))}
          </datalist>
        </div>

        <div>
          <FieldLabel>Tags</FieldLabel>
          <TextInput
            list="c4s-ui-view-tags"
            defaultValue={tagText}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                tags: e.target.value
                  .split(',')
                  .map((t) => t.trim())
                  .filter(Boolean),
              }))
            }
            placeholder="comma-separated"
            aria-label="Tags"
          />
          <datalist id="c4s-ui-view-tags">
            {knownTags.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </div>

        <InlineError message={error} />
        <PopoverFooter
          busy={busy}
          submitLabel="Save"
          onCancel={onClose}
          onSubmit={() => void save()}
        />
      </div>
    </SlashPopoverShell>
  );
}

/**
 * Mount the popover imperatively, inside the host's OWN query client.
 *
 * Imperative rather than declarative for the reason the code-snippet card gives:
 * the trigger is an Alt+click deep inside a Tiptap node view, where there is no
 * place to hang popover state that survives the editor's own re-renders.
 *
 * The `QueryClientProvider` around it is the part that is easy to leave out and
 * expensive to. A detached `createRoot` is a SECOND React tree with no provider,
 * so a write performed inside it lands on the server and reaches no cache: the
 * chip the author just edited keeps rendering the old title until something else
 * happens to refetch it, which reads as the save having failed. Passing the
 * host's shared `queryClient` — the same instance every hook in the app is bound
 * to, published for exactly this — makes the invalidation below reach the chip
 * that opened the popover. This mirrors `mountSlashCreatePopover`, which pays
 * the same cost for the same reason.
 */
export function openUiViewEditPopover({
  entity,
  onSaved,
}: {
  entity: UiView;
  onSaved?: (updated: UiView) => void;
}): void {
  if (typeof document === 'undefined') return;
  const host = document.createElement('div');
  host.dataset.plugin = 'ui-view-edit';
  document.body.appendChild(host);
  void (async () => {
    const [runtime, { QueryClientProvider }] = await Promise.all([
      import('@c4s/plugin-runtime') as Promise<{ queryClient: unknown }>,
      import('@tanstack/react-query'),
    ]);
    const root = createRoot(host);
    const close = () => {
      root.unmount();
      host.remove();
    };
    root.render(
      <QueryClientProvider client={runtime.queryClient as never}>
        <UiViewEditForm entity={entity} onClose={close} onSaved={onSaved} />
      </QueryClientProvider>,
    );
  })();
}
