import type { DataDeclaration, SlugPattern } from '@c4s/plugin-runtime';

/**
 * What an `mcp-tool` IS.
 *
 * The field set is an image of the `Tool` shape from the MCP protocol (revision
 * `2025-06-18`): `name`, `description`, `inputSchema`, optional `outputSchema`,
 * `annotations`. A field with no counterpart in the protocol does not enter —
 * the single deliberate exception is `logic`, which is not a contract.
 *
 * Two concessions to readability against a faithful transcription:
 *
 *   - `inputSchema` (JSON Schema) becomes `params[]`, a FLAT list of named
 *     fields. It expresses no `oneOf`, no patterns and no nesting; a deep shape
 *     is described in prose in that parameter's `description`. Written down so a
 *     future tool taking a nested object reads as a known limit rather than an
 *     oversight.
 *   - `outputSchema` becomes the pair `returns` + `sampleReturn`: the shape is
 *     captured BY EXAMPLE instead of by schema.
 *
 * And one absence worth naming, because its absence is a decision: there is NO
 * ERROR-CODE DICTIONARY, because the protocol has none. On the wire there is
 * only `isError: true` plus text; the taxonomy belongs to the operations layer,
 * where codes are declared once and mapped per channel. A refusal condition is
 * one sentence in `logic`, never a table.
 *
 * The sharper boundary this type exists to hold: the record carries only what
 * transfers VERBATIM into a tool definition in code. Everything describing the
 * OPERATION — canonical name, scope, mediation class, the four-channel matrix,
 * ergonomics, error codes — lives in the `## Operacje (L3)` row of the owning
 * module and is deliberately not here. Hence no `operationName`, no
 * `sideEffects`, no `idempotent`, no `readOnly`, no `status`: each would mirror
 * the catalog row and drift from it, which is the second source of truth the
 * operations layer exists to abolish.
 *
 * NO FIELD IS `contentBearing`, and that is also a decision rather than an
 * omission — see the note on `logic` below.
 */
export const mcpToolData: DataDeclaration = {
  schema: {
    /**
     * The reserved title, DERIVED rather than authored.
     *
     * `raw`, not `slugify`: a title keeps the server's and the tool's spelling
     * exactly as the wire carries them. Derivation runs ONCE, at create — the
     * same rule as the slug — so renaming the tool later does not silently move
     * a label somebody may have cited.
     */
    title: {
      type: 'string',
      required: true,
      maxLength: 200,
      computedDefault: [
        { op: 'raw', field: 'server' },
        { op: 'literal', value: ' · ' },
        { op: 'raw', field: 'name' },
      ],
      description: 'Display label. Derived once at create as `{server} · {name}`.',
    },

    /** The tool's name on the wire — the `{name}` of `mcp__{server}__{name}`. */
    name: {
      type: 'string',
      required: true,
      maxLength: 100,
      description: 'Tool name as it appears on the wire.',
    },

    /**
     * The server the tool belongs to — the `{server}` of `mcp__{server}__{name}`,
     * and an input to the slug pattern.
     *
     * STRUCTURAL, and mirrored into a `srv-{server}` tag because list embedding
     * filters by tag and never by field value. See `identity.ts` for why nothing
     * validates that pair.
     */
    server: {
      type: 'string',
      required: true,
      maxLength: 60,
      description: 'MCP server this tool belongs to. Mirrored into a `srv-{server}` tag.',
    },

    /**
     * THE CONTRACT. Transferred to the tool definition without rewriting — so it
     * carries no cross-reference to a specification section, anchor, page name or
     * module number. A `description` that needs the spec to be understood is not
     * a description a model can act on.
     */
    description: {
      type: 'string',
      required: true,
      maxLength: 2000,
      description: 'What the tool does and when to use it. Goes to the model verbatim.',
    },

    /**
     * `inputSchema`, as a flat list of named fields.
     *
     * `identity: ['name']` is the whole physical decision here, and it is made
     * AGAINST index matching: in the protocol's `inputSchema` parameters are a
     * MAP KEYED BY NAME, not a list, so position carries no meaning. Matching by
     * index would turn swapping two parameters into a cascade of `item_modified`
     * with no change of contract behind it.
     *
     * No `keyFields`, so this stays embedded JSON on the parent row rather than
     * projecting to a table: a parameter list is read with its tool and never
     * queried across tools.
     */
    params: {
      type: 'collection',
      collection: { kind: 'value', identity: ['name'] },
      description:
        'The tool’s parameters — the flat reading of `inputSchema`. Deep shapes are ' +
        'described in prose in a parameter’s own `description`; this list expresses no ' +
        'nesting, no `oneOf` and no patterns.',
      item: {
        type: 'object',
        fields: {
          name: { type: 'string', required: true, description: 'Parameter name.' },
          type: {
            type: 'string',
            required: true,
            description: 'Type as written: string | number | boolean | object | string[] | enum(…).',
          },
          required: { type: 'boolean', default: false, description: 'The parameter is required.' },
          default: { type: 'string', description: 'Default value, as written.' },
          description: {
            type: 'string',
            description: 'Reaches the parameter’s JSON Schema — written for the model.',
          },
        },
      },
    },

    /**
     * `outputSchema`, half one: PROSE ABOUT THE PAYLOAD, never about the envelope.
     *
     * An MCP tool returns `content[]` of text blocks — JSON is a convention of
     * the text's CONTENT, not the shape of the response. The output and error
     * envelope (`content[]`, `isError`) is a constant of the L3 layer and is not
     * repeated in any entity, so this field carries only what varies: what comes
     * back, and in what form.
     */
    returns: {
      type: 'string',
      maxLength: 500,
      clearable: true,
      description: 'What the tool returns, as prose. The payload only — never the MCP envelope.',
    },

    /**
     * `outputSchema`, half two: the shape BY EXAMPLE.
     *
     * This field has a built-in failure mode — it becomes a dumping ground for
     * copied responses. The rule is therefore NARROWING: fill it only when the
     * return value is nested or carries an array of objects. A flat return
     * (`{ linked: true }`, `{ ok, warnings[] }`) fits in `returns` and leaves
     * this empty. No schema can enforce that; an acceptance criterion does.
     */
    sampleReturn: {
      type: 'string',
      column: 'sample_return',
      maxLength: 1000,
      clearable: true,
      description:
        'Example JSON return. ONLY for a return that is nested or carries an array of ' +
        'objects — a flat return belongs in `returns` and leaves this empty.',
    },

    /*
     * The four behavioural hints of the protocol's `annotations` (revision
     * `2025-03-26`).
     *
     * OPTIONAL AND WITHOUT `default`, deliberately. The protocol gives them
     * defaults (`false` / `true` / `false` / `true`); this schema does not, so
     * that "the server declares no annotation" stays a state distinguishable
     * from an explicit `false` on every read surface and in every render. A
     * `default` here would erase that distinction at the DDL — a defaulted
     * column is NOT NULL and can never hold the absent case.
     *
     * They are also not a gate. The MCP spec says a client MUST treat
     * annotations as UNTRUSTED unless the server itself is trusted: these are
     * hints feeding an "ask the user for consent" decision, not guarantees. Hard
     * limits live in the context profile and in the L3 catalog row.
     */
    readOnlyHint: {
      type: 'boolean',
      column: 'read_only_hint',
      clearable: true,
      description: 'Annotation hint. Absent means the server declares nothing — not `false`.',
    },
    destructiveHint: {
      type: 'boolean',
      column: 'destructive_hint',
      clearable: true,
      description: 'Annotation hint. Absent means the server declares nothing — not `false`.',
    },
    idempotentHint: {
      type: 'boolean',
      column: 'idempotent_hint',
      clearable: true,
      description: 'Annotation hint. Absent means the server declares nothing — not `false`.',
    },
    openWorldHint: {
      type: 'boolean',
      column: 'open_world_hint',
      clearable: true,
      description: 'Annotation hint. Absent means the server declares nothing — not `false`.',
    },

    /**
     * The tool's INSIDE — and the only field here that is not a contract.
     *
     * Markdown describing order of steps, validations, refusal conditions,
     * best-effort behaviour. It does NOT reach the tool definition and is NOT
     * sent to the model: it is material for whoever codes the tool. It does not
     * restate `description` — that one says "what it does and when to use it",
     * this one says "how it does it inside".
     *
     * Flagging it `contentBearing` (as `diagram` flags its `source`) was
     * considered and REJECTED. This is short markdown under a hard 1000-character
     * cap, not a payload of arbitrary size, and the consequences of the flag are
     * operational: the whole record stays visible in every generic read, there is
     * no second operation handing out the content, and `field_changed_opaque`
     * cannot occur for this type at all. The cap doubles as discipline — logic
     * that will not fit is a signal that the tool does too much, or that the
     * description has slid into implementation.
     */
    logic: {
      type: 'string',
      maxLength: 1000,
      clearable: true,
      description:
        'How the tool works inside — steps, validations, refusal conditions. Markdown. ' +
        'Never sent to the model; material for whoever codes it.',
    },

    createdAt: { type: 'string', column: 'created_at', systemManaged: true, computedDefault: 'now' },
    updatedAt: { type: 'string', column: 'updated_at', systemManaged: true, computedDefault: 'now' },
  },
};

/**
 * `{slugify(server)}-{slugify(name)}`.
 *
 * Evaluated ONLY at create, and an explicit slug in the create call always wins.
 * The slug is therefore STABLE UNDER AN EDIT OF `name`: renaming the tool on the
 * wire does not by itself rename the entity. Closing that gap is an explicit
 * `newSlug`, which carries the standard reference propagation with it.
 */
export const mcpToolSlugPattern: SlugPattern = [
  { op: 'slugify', field: 'server' },
  { op: 'literal', value: '-' },
  { op: 'slugify', field: 'name' },
];
