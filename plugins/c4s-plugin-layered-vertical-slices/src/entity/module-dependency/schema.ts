import type { DataDeclaration, SlugPattern } from '@c4s/plugin-runtime';

/**
 * What a `module-dependency` IS: one DIRECTED edge, four fields, all scalar.
 *
 * The unit is the ORDERED PAIR. A mutual relation is two entities, not one with
 * a direction flag — which is what lets each side carry its own `needs` and its
 * own tag, and what makes `m19-requires-m13` and `m13-requires-m19` two slugs
 * that never collide.
 *
 * EVERY FIELD CARRIES `maxLength`, and that is a requirement rather than
 * tidiness: `field_changed_opaque` fires on `contentBearing` OR on the absence
 * of any value constraint, and this type's whole delta story is that it is
 * purely scalar — `field_changed` on the three authored fields plus
 * `tag_added` / `tag_removed`, with no collection to declare item identity for.
 *
 * NO FIELD CARRIES `ref`, and the cost is stated rather than discovered: a
 * module is a PARTY to this edge, not an entity type, so there is nothing for a
 * ref to point at. A typo in a module number therefore produces no `broken`
 * marker in `check_consistency` — it produces a silent false edge. That is what
 * the three warning rules in the host exist to catch.
 */
export const moduleDependencyData: DataDeclaration = {
  schema: {
    /**
     * Reserved on every type, and RESERVED IN PRACTICE TOO: the author never
     * fills it. `computedDefault` derives it from the two parties, so the write
     * path fills it before `allocateSlug` runs.
     */
    title: {
      type: 'string',
      required: true,
      maxLength: 200,
      computedDefault: [
        { op: 'raw', field: 'dependent' },
        { op: 'literal', value: ' wymaga od ' },
        { op: 'raw', field: 'provider' },
        { op: 'truncate', n: 200 },
      ],
      description:
        'Label. Derived as "{dependent} wymaga od {provider}" — a reserved field the author does not fill.',
    },

    /**
     * The module that REQUIRES. Scalar and required, and both properties are
     * load-bearing: this is the side the entity is tagged by, so the outgoing
     * edges of a module are read by tag.
     */
    dependent: {
      type: 'string',
      required: true,
      maxLength: 8,
      description: 'The module that requires. The entity carries this module’s tag.',
    },

    /**
     * The module that is REQUIRED FROM — and the reason this field is a declared
     * scalar rather than prose.
     *
     * `list_entities({ filters })` matches on declared scalar leaves and nothing
     * else, so `filters: { provider: "MNN" }` is the ONLY way to read a module's
     * INCOMING edges: they carry the other module's tag, so no tag query finds
     * them. Drop the field to prose and that read simply ceases to exist.
     */
    provider: {
      type: 'string',
      required: true,
      maxLength: 8,
      description:
        'The module that is required from. Incoming edges are read with filters on this field, never by tag.',
    },

    /**
     * WHAT flows — never BETWEEN WHOM.
     *
     * Deliberately NOT `contentBearing`: one or two sentences is a value to
     * compare, not bulk content, and flagging it would collapse its delta to a
     * byte count and drop it out of `searchableFields`.
     *
     * A module identifier inside this text is an error — the parties are already
     * named by `dependent` and `provider`, and repeating one here gives a fact
     * two homes. Watched by a warning rule, since no schema constraint describes
     * an open set of module numbers.
     */
    needs: {
      type: 'string',
      required: true,
      kind: 'non-empty',
      maxLength: 400,
      description:
        'Prose: what this module would lose without the other. Says what flows, never between whom — no module identifier belongs here.',
    },

    createdAt: { type: 'string', column: 'created_at', systemManaged: true, computedDefault: 'now' },
    updatedAt: { type: 'string', column: 'updated_at', systemManaged: true, computedDefault: 'now' },
  },
};

/**
 * `{slugify(dependent)}-requires-{slugify(provider)}` — e.g. `m19-requires-m13`.
 *
 * Evaluated ONLY at create, so editing either party later does not move the slug
 * and does not touch a single reference; a rename goes through `newSlug`.
 *
 * The pair is NOT unique and the host does not pretend otherwise: describing the
 * same pair twice is suffixed (`-2`) rather than refused — see `slugConflict` on
 * the contribution. Direction never collides, because the two orderings slugify
 * differently.
 */
export const moduleDependencySlugPattern: SlugPattern = [
  { op: 'slugify', field: 'dependent' },
  { op: 'literal', value: '-requires-' },
  { op: 'slugify', field: 'provider' },
];
