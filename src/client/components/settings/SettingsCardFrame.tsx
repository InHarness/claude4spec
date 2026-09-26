import { useCallback, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { usePatchConfig } from '../../hooks/useConfig.js';
import { ApiError, type ConfigPatch, type ConfigResponse } from '../../lib/api.js';
import { toast } from '../../ui/events.js';
import { SettingsCard } from './SettingsCard.js';
import { GeneratedElement } from './controls.js';
import {
  effectMessagesFor,
  elementKeys,
  keyId,
  readKey,
  sameValue,
  writeKey,
  type AssembledCard,
  type CardDraft,
  type ConfigKeyPath,
  type ElementContext,
} from './registry.js';

/**
 * 0.2.113 — one card of `/settings`, rendered from its declaration.
 *
 * SAVE IS PER CARD. A card with at least one element bound to a key of
 * `config.json` gets a [Save] that sends ONE `PATCH /api/config` with the keys of
 * THIS card that actually changed. A card without such elements has no [Save];
 * its elements work through their own routes.
 *
 *  - success → a toast with the effect message of every changed element, each
 *    once. No banners, no effect-class badges: the message says WHEN the change
 *    acts, never what class it is;
 *  - refusal → the error under the control of the key the server pinned it to.
 *    The save is atomic: one refused key refuses the whole card;
 *  - a live validation error blocks [Save] before anything is sent; a warning
 *    never does.
 */
export function SettingsCardFrame({ card, config }: { card: AssembledCard; config: ConfigResponse }) {
  const patch = usePatchConfig();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [edits, setEdits] = useState<Map<string, { key: ConfigKeyPath; value: unknown }>>(() => new Map());
  const [serverErrors, setServerErrors] = useState<Map<string, string>>(() => new Map());
  const [liveErrors, setLiveErrors] = useState<Map<string, string>>(() => new Map());
  const [busy, setBusy] = useState<string | null>(null);

  // What an unedited key shows — config's value, or the declarant's reading of an
  // absent one (see `SettingsElementDecl.baseline`).
  const baselineOf = useCallback(
    (key: ConfigKeyPath): unknown => {
      const decl = card.elements.find((e) => e.configKey && keyId(e.configKey) === keyId(key));
      return decl?.baseline ? decl.baseline(config) : readKey(config, key);
    },
    [card.elements, config],
  );

  const draft: CardDraft = useMemo(
    () => ({
      get: (key) => {
        const edit = edits.get(keyId(key));
        return edit ? edit.value : baselineOf(key);
      },
      set: (key, value) => {
        const id = keyId(key);
        setEdits((prev) => {
          const next = new Map(prev);
          // Typing a value back to what config holds is not an edit.
          if (sameValue(value, baselineOf(key))) next.delete(id);
          else next.set(id, { key, value });
          return next;
        });
        setServerErrors((prev) => {
          if (!prev.has(id)) return prev;
          const next = new Map(prev);
          next.delete(id);
          return next;
        });
      },
      error: (key) => serverErrors.get(keyId(key)) ?? liveErrors.get(keyId(key)) ?? null,
      setLiveError: (key, message) =>
        setLiveErrors((prev) => {
          const id = keyId(key);
          if ((prev.get(id) ?? null) === message) return prev;
          const next = new Map(prev);
          if (message) next.set(id, message);
          else next.delete(id);
          return next;
        }),
      isDirty: (key) => edits.has(keyId(key)),
      saving: patch.isPending,
      setBusy,
    }),
    [edits, serverErrors, liveErrors, baselineOf, patch.isPending],
  );

  const ctx: ElementContext = { config, draft };
  const visibleElements = card.elements.filter((e) => !e.visible || e.visible(ctx));
  const fileBacked = card.elements.some((e) => elementKeys(e).length > 0);

  // Live (UI:) validation of the generated elements, over what is on screen now.
  const generatedErrors = visibleElements.flatMap((e) => {
    if (!e.validate || !e.configKey) return [];
    const r = e.validate(draft.get(e.configKey), ctx);
    return r?.error ? [r.error] : [];
  });
  const changed = [...edits.values()].filter((e) => !sameValue(e.value, baselineOf(e.key)));
  const blocked = generatedErrors.length > 0 || liveErrors.size > 0;
  const canSave = changed.length > 0 && !blocked && !patch.isPending && busy === null;

  const handleSave = useCallback(async () => {
    if (!canSave) return;
    const body: Record<string, unknown> = {};
    for (const e of changed) writeKey(body, e.key, e.value);
    setServerErrors(new Map());
    try {
      const res = await patch.mutateAsync(body as ConfigPatch);
      setEdits(new Map());
      const changedIds = new Set(changed.map((e) => keyId(e.key)));
      for (const el of card.elements) {
        if (el.afterSave && elementKeys(el).some((k) => changedIds.has(keyId(k)))) {
          await el.afterSave({ router, queryClient });
        }
      }
      const messages = effectMessagesFor(card.elements, changed.map((e) => e.key));
      toast.success(messages.length > 0 ? messages.join(' ') : `${card.decl.title} saved.`);
      for (const w of res.warnings ?? []) toast.warning(w);
    } catch (err) {
      if (err instanceof ApiError) {
        const field = typeof err.details?.field === 'string' ? err.details.field : null;
        const target = field ? changed.find((e) => keyId(e.key) === field) : undefined;
        if (target) {
          setServerErrors(new Map([[keyId(target.key), err.message]]));
          return;
        }
        toast.error(err.message);
        return;
      }
      toast.error(`${card.decl.title}: save failed`);
    }
  }, [canSave, changed, card, patch, router, queryClient]);

  return (
    <SettingsCard id={card.decl.anchor} title={card.decl.title} description={card.decl.description} tone={card.decl.tone}>
      <div className="flex flex-col gap-4">
        {visibleElements.map((e) => {
          if (e.kind === 'custom') {
            const Custom = e.component;
            return Custom ? <Custom key={e.id} decl={e} {...ctx} /> : null;
          }
          return <GeneratedElement key={e.id} decl={e} {...ctx} />;
        })}
        {fileBacked ? (
          <div className="flex items-center justify-end gap-3">
            {busy ? (
              <span className="text-[11.5px]" style={{ color: 'var(--c-muted)' }}>
                {busy}
              </span>
            ) : null}
            <button
              type="button"
              disabled={!canSave}
              onClick={() => void handleSave()}
              data-testid={`settings-save-${card.decl.anchor}`}
              className="rounded-md px-3 py-1.5 text-[12px] font-medium disabled:opacity-50"
              style={{ background: 'var(--c-accent)', color: '#fff' }}
            >
              {patch.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        ) : null}
      </div>
    </SettingsCard>
  );
}
