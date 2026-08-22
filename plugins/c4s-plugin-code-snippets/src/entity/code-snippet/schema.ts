import type { DataDeclaration, SlugPattern } from '@c4s/plugin-runtime';
import { DEFAULT_LANGUAGE, LANGUAGE_ALIASES } from '../../identity.js';

/**
 * What a `code-snippet` IS: four fields, all scalar, all bounded.
 *
 * The type exists for ONE reason that is not about rendering — a fenced code
 * block is not an edge in the reference graph, so `find_references` and
 * `check_consistency` cannot see it. Syntax highlighting is what the card gives
 * you on the way; it is not what the type is for. (The open question of
 * highlighting the ~200 fences BELOW the promotion threshold is a Tiptap
 * extension in the editor, not more entities, and is deliberately not here.)
 *
 * EVERY FIELD CARRIES `maxLength`, and that is a hard requirement rather than
 * tidiness. `field_changed_opaque` fires on `contentBearing` OR on the absence
 * of any value constraint; an unbounded `language` would make this type's delta
 * stop being purely scalar.
 *
 * NO FIELD IS `contentBearing` — see the note on `code` below, which is the
 * whole design of the type.
 *
 * Absent by decision, not by oversight:
 *   - `caption` — it is an attribute of the REFERENCE, per placement. The same
 *     snippet embedded on two pages carries two different captions, so it
 *     appears in neither the schema, nor the snapshot, nor the projection.
 *   - `highlightLines` / region markers — the same logic exactly. "Which lines
 *     to emphasise" is a property of the embedding, not of the fragment. If they
 *     ever land they are attributes of the reference tag, never columns here.
 *   - `description` — covered by `title` plus the reference's `caption`.
 *   - anything binding the snippet to a file in the repository. A snippet is
 *     AUTHORED. Nothing reads project sources and nothing keeps it in step with
 *     real code; believing otherwise is the failure mode this absence prevents.
 */
export const codeSnippetData: DataDeclaration = {
  schema: {
    /** The reserved title of every type. Drives the slug, once, at create. */
    title: {
      type: 'string',
      required: true,
      maxLength: 200,
      description: 'Display name of the snippet. Drives the slug at create, and only then.',
    },

    /**
     * The grammar name, as a FREE STRING with a normalization table — not an
     * enum. See `LANGUAGE_ALIASES` for why: an enum would turn every new
     * language into a `payloadUpgrades` step, and the spread being corrected is
     * between spellings of the same language.
     *
     * `normalize` is what lets this package have NO `backend` slot while still
     * canonicalizing on write: the host applies it on the generic write path, so
     * REST and the generic MCP tools get it identically.
     */
    language: {
      type: 'string',
      default: DEFAULT_LANGUAGE,
      maxLength: 30,
      normalize: { case: 'lower', aliases: LANGUAGE_ALIASES },
      description:
        'Grammar name for highlighting. Lower-cased on write and passed through a closed ' +
        'alias table; an unknown value is stored as-is and renders as plaintext, never an error.',
    },

    /**
     * An optional path shown in the card header instead of `title`.
     *
     * Decorative and CLEARABLE: it says where a reader would find this shape in
     * a real tree, and nothing resolves it. A snippet with no natural home has
     * none, which is why it is not required.
     */
    filename: {
      type: 'string',
      clearable: true,
      maxLength: 200,
      description: 'Optional path shown in the card header in place of the title. Never resolved.',
    },

    /**
     * THE FRAGMENT — and deliberately NOT `contentBearing`. This is the most
     * consequential decision in the type, so the three consequences are written
     * down rather than rediscovered:
     *
     *   - DIFF: `code` gets an ordinary `field_changed` with `from`/`to` filled,
     *     which the version history renders as a line diff. Flagged, it would
     *     collapse to `field_changed_opaque` — "156 B → 178 B" — which is the
     *     one thing nobody wants to read about a code change.
     *   - SEARCH: `contentBearing` is the ONLY thing that removes a field from
     *     `searchableFields`; there is no exclusion by length. Unflagged,
     *     `search_entities` reaches into the code itself. (That is also why this
     *     package contributes no `search_code_snippets` tool — it would be a
     *     second answer to a question the generic tool already answers.)
     *   - THE COST, ACCEPTED KNOWINGLY: the whole record is visible in every
     *     generic read, so `get_entities` without `select` emits the full `code`.
     *     List reads are unaffected — `list_entities` emits a frozen
     *     `{ slug, title }` row with no width parameter.
     *
     * The 10 000-character cap is the discipline that makes the cost bearable —
     * the same reasoning as `mcp-tool.logic`. Code that does not fit is not an
     * example of a form, it is a dump of an implementation, and it fails the
     * promotion threshold. Derived from the corpus: the heaviest fence in it is
     * 191 lines / ~9.5k characters, and it fails the threshold anyway. The cap
     * REFUSES; it never truncates silently.
     */
    code: {
      type: 'string',
      required: true,
      // `required` alone would accept `''` — it refuses `null` and a missing
      // key, and an empty string is a value. A snippet whose whole content is
      // empty is not a legal state of this type, so the shape rule is named
      // explicitly rather than assumed.
      kind: 'non-empty',
      maxLength: 10000,
      description:
        'The snippet itself, verbatim. ~200 lines. Deliberately not contentBearing, so it ' +
        'diffs as lines and is reachable by search.',
    },

    createdAt: { type: 'string', column: 'created_at', systemManaged: true, computedDefault: 'now' },
    updatedAt: { type: 'string', column: 'updated_at', systemManaged: true, computedDefault: 'now' },
  },
};

/**
 * `{slugify(title)}`.
 *
 * Evaluated ONLY at create, and an explicit slug in the create call always wins.
 * So editing `title` later does NOT move the slug and does not touch a single
 * reference — renaming is `newSlug`, which carries the standard M19 repointing
 * with it. Collisions are suffixed rather than refused; see the `slugConflict`
 * note on the contribution.
 */
export const codeSnippetSlugPattern: SlugPattern = [{ op: 'slugify', field: 'title' }];
