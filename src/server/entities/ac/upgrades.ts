import type { SnapshotData } from '../../serialization/types.js';

/** The bound `title` declares in `acData`, repeated where the refusal is decided. */
const AC_TITLE_MAX_LENGTH = 500;

/**
 * payload 1 → 2: every AC gains the reserved `title`.
 *
 * `title := truncate(text, 200)` — the derivation `acData` declared as the
 * field's `computedDefault` at the time, applied here to entities written before
 * the field existed. Stated twice on purpose: the schema's copy filled the field
 * on a NEW create, this one fills it on an OLD file, and there is no shared
 * runtime between a create payload and a snapshot being upgraded.
 *
 * The 200 is FROZEN at what this step meant when it shipped, and does not follow
 * `title`'s bound as that bound moves. A migration step is a historical fact
 * about a file written under a past shape; re-reading it against today's schema
 * would make old payloads change meaning every time the schema does. The result
 * this step produces is superseded wholesale by v2 → v3 below anyway.
 *
 * `text` is left alone here. It was the criterion; `title` was a label for it.
 *
 * Idempotent: an already-upgraded payload carries a `title` and is returned
 * untouched, which is what makes a re-run after a partial index safe.
 */
export function acPayloadV1ToV2(payload: SnapshotData): SnapshotData {
  const data = payload as Record<string, unknown>;
  if (typeof data.title === 'string' && data.title.trim() !== '') return payload;
  const text = typeof data.text === 'string' ? data.text : '';
  return { ...data, title: text.slice(0, 200) } as SnapshotData;
}

/**
 * payload 2 → 3: `title := text`, then `text` and `description` are gone.
 *
 * The whole of 0.2.51 for an entity already on disk. `title` stops being a label
 * derived from a longer field and becomes the criterion, so the criterion moves
 * INTO it — in full, overwriting whatever v1 → v2 truncated to 200 characters.
 * That overwrite is the point: after this step the 200-character copy would be
 * the only surviving text, and the assertion would have been quietly shortened.
 *
 * THIS STEP REFUSES. `text` carried no bound, `title` carries 500, and M13
 * allows a narrowing migration either to truncate or to refuse with the
 * offending slugs. Truncating here would cut a sentence in half in the one field
 * that states what the software must do — an AC reading "the request is rejected
 * when the token is" is worse than an AC that is loudly missing. So a `text`
 * past 500 characters throws, and the refusal is not free: `entity-indexer`
 * degrades a failed upgrade to "skip this entity", which means the file stays on
 * disk and the entity drops out of `list_entities`, `search_entities` and
 * `get_entities` with only a backend `warn` to say so.
 *
 * WHICH MAKES THIS RELEASE CONDITIONAL, and the condition belongs to the DATA,
 * not the code: raising `payloadVersion` to 3 is safe exactly when no AC in the
 * project has text longer than 500 characters. Shipping it over a non-empty set
 * is a silent loss of those entities, not a loud error. The error message below
 * names the slug and the length precisely so the fix is "shorten or split these
 * N criteria", not "something failed during indexing".
 *
 * `description` is dropped without inspection. It was optional prose beside the
 * criterion, the type now has one authored field, and there is nowhere for the
 * text to go that would not be a guess at the author's intent.
 *
 * Idempotent: a payload with no `text` key has already been through this step
 * (or was written at v3) and comes back untouched.
 */
export function acPayloadV2ToV3(payload: SnapshotData): SnapshotData {
  const data = payload as Record<string, unknown>;
  if (!('text' in data)) return payload;
  const text = typeof data.text === 'string' ? data.text : '';
  if (text.length > AC_TITLE_MAX_LENGTH) {
    const slug = typeof data.slug === 'string' ? data.slug : '(unknown slug)';
    throw new Error(
      `${slug}: text is ${text.length} characters and \`title\` is bounded at ${AC_TITLE_MAX_LENGTH} — ` +
        'this step refuses rather than truncating the criterion. Shorten it, or split it into the ' +
        'several criteria it probably is, and re-run',
    );
  }
  const { text: _text, description: _description, ...rest } = data;
  return { ...rest, title: text } as SnapshotData;
}

export const acPayloadUpgrades = [acPayloadV1ToV2, acPayloadV2ToV3];
