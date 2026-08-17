/**
 * Host API 2.0.0 — the logical schema is validated AT REGISTRATION.
 *
 * Same temporal argument as `composition-validation.ts`, one step earlier in the
 * chain: a schema is a licence to GENERATE DDL and to interpolate field-derived
 * identifiers into it. Discovering at `applyProjection` time that an identifier
 * was not an identifier is discovering it at boot, with `db.exec` already
 * holding a multi-statement string. Every check below runs while the manifest is
 * still being lowered, where the only consequence of rejection is that the
 * plugin does not load.
 *
 * The brief's four named rejections are all here and all LOUD — never a silent
 * truncation or a defaulted-in guess:
 *   1. a collection node without `collection: 'value' | 'keyed'`;
 *   2. an integrity constraint outside the closed vocabulary;
 *   3. a schema deeper than the projection can walk;
 *   4. an identifier failing the `sql-identifier` rule (snake_case plus the
 *      host-maintained reserved-word list).
 *
 * 0.2.22 adds three more, on the same terms:
 *   5. a schema without the reserved `title` field — rejected on the SAME path
 *      as one without `data.schema`, because both mean "this does not describe
 *      an entity this host can serve";
 *   6. a `computedDefault` reading a field that does not exist, itself, or
 *      another computed field;
 *   7. a `contentBearing` field naming a `contentOperation` that resolves to no
 *      operation — the reachability rule that replaces the retired
 *      views-versus-contentBearing ban.
 */

import {
  MAX_PROJECTION_DEPTH,
  RESERVED_TITLE_FIELD,
  TITLE_MAX_LENGTH,
  columnOf,
  hasProjectionTable,
  isEmbedded,
  payloadFieldsOf,
  walkSchema,
  type CollectionNode,
  type DefaultPredicate,
  type DataDeclaration,
  type FieldNode,
  type IntegrityConstraint,
} from '../../../shared/plugin-host/data-schema.js';
import { CATALOG } from '../../operations/catalog.js';
import {
  alternativesOf,
  slugPatternFields,
  slugPatternIsTotal,
  type SlugPattern,
} from '../../../shared/plugin-host/slug-pattern.js';
import { PluginManifestError } from './manifest-adapter.js';
import { SQL_RESERVED_WORDS } from '../../../shared/plugin-host/sql-reserved-words.js';

/**
 * snake_case only — stricter than the bare-identifier rule in
 * `composition-validation.ts`, and deliberately so. That rule guards a name the
 * author WROTE; this one guards a name the host DERIVES from a payload field, so
 * accepting `MyField` would let the generated DDL depend on a case convention
 * SQLite treats as insignificant for identifiers but every diff tool treats as
 * significant.
 */
const SNAKE_CASE_RE = /^[a-z_][a-z0-9_]*$/;

/**
 * Hoisted to `shared/` so `ScalarNode.notReserved` screens caller-supplied
 * VALUES against the very list this file screens host-derived IDENTIFIERS with.
 * Aliased rather than renamed at the ~30 use sites below.
 */
const RESERVED_WORDS = SQL_RESERVED_WORDS;

/** Column names the host writes on every entity row; a type may not redeclare them. */
const HOST_RESERVED_COLUMNS: ReadonlySet<string> = new Set(['slug', 'id']);

/**
 * A CHECK expression is interpolated into generated DDL and reaches `db.exec`,
 * which runs MULTIPLE statements. It is therefore ALLOWLISTED, exactly as
 * `composition-validation.ts` allowlists a scope predicate, and for exactly the
 * same reason: without it, `expr: "1); DROP TABLE plan; --"` produces
 * `CHECK (1); DROP TABLE plan; --)` and drops a host table at boot — a table the
 * entity rebuild cannot regenerate, since plans are not entity files.
 *
 * This release deleted `countStat.sqlQuery` to close precisely that surface;
 * accepting an unscreened expression here would have reopened it wider, because
 * a CHECK runs at CREATE time rather than on demand.
 *
 * Comparison, arithmetic, boolean connectives, quoted literals, parenthesised
 * groups and bare identifiers are enough to express every constraint the closed
 * vocabulary is for. `;` is absent from the set — one statement, always.
 */
const CHECK_EXPR_ALLOWED_RE = /^[A-Za-z0-9_ '"=<>!+\-*/%().,|]+$/;

function fail(type: string, message: string): never {
  throw new PluginManifestError(`entity type "${type}" — data.schema: ${message}`);
}

/** Rule 4. Exported so the projection generator can assert the same invariant on its own output. */
export function assertSqlIdentifier(type: string, value: string, what: string): void {
  if (!SNAKE_CASE_RE.test(value)) {
    fail(
      type,
      `${what} "${value}" is not a valid SQL identifier — snake_case, starting with a letter or ` +
        `underscore. The host emits bare identifiers into generated DDL, so the name must be safe ` +
        `unquoted`,
    );
  }
  if (RESERVED_WORDS.has(value)) {
    fail(
      type,
      `${what} "${value}" is a reserved SQL word. Generated DDL emits it unquoted, which would be a ` +
        `syntax error at CREATE TABLE time — rename the field or declare an explicit \`column\``,
    );
  }
}

/**
 * A keyed collection's two axes must resolve, at registration, to real fields.
 *
 * Both halves of an axis are a NAME pointing somewhere else, and a name that
 * does not resolve fails far from here and unhelpfully: an unresolvable `key`
 * makes the window builder address a column that is not in the table, and an
 * unresolvable `extent` makes `overview` report `undefined` dimensions for a
 * grid that has rows. Neither is visible until someone reads the collection,
 * which for a rarely-opened type can be much later than the boot that accepted
 * the manifest.
 *
 * `extent` resolves against the TOP-LEVEL schema, never against the item: it is
 * the parent's dimension, and reading it is the whole reason `overview` can
 * answer without materializing a single item body.
 */
function checkAxes(
  type: string,
  schema: DataDeclaration['schema'],
  path: string,
  node: CollectionNode,
): void {
  const axes = node.axes;
  if (!axes || axes.length !== 2) {
    fail(
      type,
      `keyed collection "${path}" must declare exactly two axes — its read surface is a ` +
        `rectangle over two coordinates, and a full row or column is a degenerate rectangle ` +
        `rather than a separate primitive. Got ${axes ? axes.length : 0}`,
    );
    return;
  }

  /**
   * A keyed collection must carry at least one field that is NOT part of its
   * key, and this is a refusal rather than a tolerated shape.
   *
   * A presence-style grid — where the existence of the key IS the datum, like a
   * seating chart or an occupancy mask — is a reasonable thing to want and is
   * fundamentally incompatible with sparse discipline: "an empty item is not
   * stored" is judged on the non-key fields, so with none to judge, EVERY entry
   * is empty and every write deletes the key it just named. There is no
   * behaviour to fall back to.
   *
   * Caught here because the alternative is much worse: the generated upsert's
   * assignment list is also empty, so `db.prepare` raises a bare
   * `near ")": syntax error` at the first write, aborting the entity's whole
   * transaction with a message naming no field and no type.
   */
  if (!payloadFieldsOf(node).length) {
    fail(
      type,
      `keyed collection "${path}" declares no field outside its key ` +
        `(${(node.keyFields ?? []).join(', ')}). Sparse discipline judges emptiness on the ` +
        `non-key fields, so a key-only collection would treat every entry as empty and delete ` +
        `it — declare what a cell holds, or model presence as a value collection`,
    );
  }

  const keys = new Set(node.keyFields ?? []);
  for (const axis of axes) {
    if (!keys.has(axis.key)) {
      fail(
        type,
        `keyed collection "${path}" declares axis key "${axis.key}", which is not one of its ` +
          `keyFields (${[...keys].join(', ') || 'none'}) — an axis addresses the item, so it has ` +
          `to be part of the address`,
      );
      continue;
    }
    const coordinate = node.item.type === 'object' ? node.item.fields[axis.key] : undefined;
    if (coordinate && coordinate.type !== 'number') {
      fail(
        type,
        `keyed collection "${path}" axis key "${axis.key}" is declared as '${coordinate.type}' — ` +
          `a window is a numeric range over it, so it must be a number`,
      );
    }

    const extent = schema[axis.extent];
    if (!extent) {
      fail(
        type,
        `keyed collection "${path}" declares axis extent "${axis.extent}", which is not a field ` +
          `of ${type} — the extent is the PARENT's dimension, which is what lets overview answer ` +
          `without materializing any item`,
      );
      continue;
    }
    if (extent.type !== 'number') {
      fail(
        type,
        `keyed collection "${path}" axis extent "${axis.extent}" is declared as ` +
          `'${extent.type}' — a dimension is a count, so it must be a number`,
      );
    }
    if (!isEmbedded(extent)) {
      fail(
        type,
        `keyed collection "${path}" axis extent "${axis.extent}" does not live on the ${type} ` +
          `row — overview reads it from there, so it cannot be a collection or a transient input`,
      );
    }
  }

  if (axes[0].key === axes[1].key) {
    fail(type, `keyed collection "${path}" names "${axes[0].key}" as both of its axes`);
  }
  if (axes[0].extent === axes[1].extent) {
    fail(type, `keyed collection "${path}" names "${axes[0].extent}" as both of its extents`);
  }
}

/** Rule 1 + rule 3 + identifier checks over every node in the tree. */
function checkNodes(type: string, schema: DataDeclaration['schema']): void {
  walkSchema(schema, (path, node, depth) => {
    if (depth > MAX_PROJECTION_DEPTH) {
      fail(
        type,
        `"${path}" nests ${depth} levels deep, past the projection limit of ${MAX_PROJECTION_DEPTH}. ` +
          `The schema is rejected rather than truncated: a silently-dropped branch is a field that ` +
          `writes fine, never appears in search, and vanishes from the snapshot`,
      );
    }
    /**
     * The numeric bounds belong to a number and nowhere else. Rejected rather
     * than ignored: a `min` sitting on a string is an author who believes a
     * constraint is being enforced, and the whole point of the flags is that the
     * declaration is the contract.
     */
    if (node.type !== 'number') {
      for (const flag of ['integer', 'min', 'max'] as const) {
        if ((node as unknown as Record<string, unknown>)[flag] !== undefined) {
          fail(
            type,
            `"${path}" is a ${node.type}, but carries \`${flag}\` — the numeric bounds apply to ` +
              `\`type: 'number'\` only. Silently ignoring it would leave a constraint the author ` +
              `believes is enforced`,
          );
        }
      }
    } else {
      const { min, max } = node as { min?: number; max?: number };
      if (min !== undefined && max !== undefined && min > max) {
        fail(type, `"${path}" declares min ${min} above max ${max} — no value can satisfy it`);
      }
    }

    /**
     * The string constraints, screened by the same rule and for the same reason
     * as the numeric ones: a `pattern` sitting on a boolean is an author who
     * believes a shape is enforced.
     */
    if (node.type !== 'string') {
      for (const flag of ['pattern', 'notReserved'] as const) {
        if ((node as unknown as Record<string, unknown>)[flag] !== undefined) {
          fail(
            type,
            `"${path}" is a ${node.type}, but carries \`${flag}\` — the string constraints apply ` +
              `to \`type: 'string'\` only. Silently ignoring it would leave a constraint the ` +
              `author believes is enforced`,
          );
        }
      }
    } else if (node.pattern !== undefined) {
      /**
       * Compiled HERE so a typo fails at registration, naming the type and the
       * field. `crud-schema-gen` compiles it once per generated schema, which is
       * router-construction time — far from the declaration, with no type name
       * in the message, and only for the types whose routers get built.
       */
      try {
        new RegExp(node.pattern);
      } catch (err) {
        fail(
          type,
          `"${path}" declares a \`pattern\` that does not compile: ${(err as Error).message}`,
        );
      }
    }

    if (node.type === 'collection') {
      const declared = (node as { collection?: unknown }).collection;
      if (declared !== 'value' && declared !== 'keyed') {
        fail(
          type,
          `collection "${path}" must declare \`collection: 'value' | 'keyed'\` — the two differ in ` +
            `where rows live, how restore reconciles them and how they are read, so there is no ` +
            `safe default. Got ${JSON.stringify(declared)}`,
        );
      }
      if (declared === 'keyed' && (!node.keyFields || node.keyFields.length === 0)) {
        fail(type, `keyed collection "${path}" must declare keyFields — the key IS its address`);
      }
      if (node.keyFields?.length) {
        if (node.item.type !== 'object') {
          fail(type, `collection "${path}" declares keyFields but its item is not an object`);
        } else {
          for (const key of node.keyFields) {
            if (!(key in node.item.fields)) {
              fail(type, `collection "${path}" keyField "${key}" is not a field of its item`);
            }
          }
        }
      }
      // AFTER the keyFields checks: an axis names a keyField, so "that keyField
      // does not exist" is the more specific and more actionable complaint, and
      // reporting the axes first would bury it.
      if (declared === 'keyed') checkAxes(type, schema, path, node);
    }
    if (node.type === 'record' && node.value.type === 'collection') {
      fail(type, `"${path}" nests a collection inside a record — not projectable`);
    }
  });

  /**
   * EVERY field that becomes a column, not just the top-level ones.
   *
   * The generator emits bare identifiers in two places: the parent row's
   * columns, and the columns of each table-backed collection, which come from
   * that collection's ITEM fields. Checking only the first set left the second
   * unguarded — and it is the likelier of the two to trip, because an item
   * object is a small record whose natural field names include `default`, `in`,
   * `order` and `type`. `ui-view.params` already has three of those; it stays
   * embedded today, so it is a rename away from a boot failure rather than one
   * now.
   */
  const columns: Array<{ column: string; where: string }> = [];
  for (const [name, node] of Object.entries(schema)) {
    if (isEmbedded(node)) columns.push({ column: columnOf(name, node), where: `field "${name}"` });
    if (!hasProjectionTable(node)) continue;
    const item = (node as CollectionNode).item;
    const itemFields: Array<[string, FieldNode]> =
      item.type === 'object' ? Object.entries(item.fields) : [['value', item]];
    for (const [itemName, itemNode] of itemFields) {
      columns.push({
        column: columnOf(itemName, itemNode),
        where: `item field "${name}[].${itemName}"`,
      });
    }
  }

  for (const { column, where } of columns) {
    assertSqlIdentifier(type, column, `column for ${where}`);
  }

  // Only the PARENT row carries the host's own columns; a projection table's
  // `<type>_slug` binding is host-generated and cannot collide with an item
  // field, since the binding is derived from the type slug rather than declared.
  for (const [name, node] of Object.entries(schema)) {
    if (!isEmbedded(node)) continue;
    const column = columnOf(name, node);
    if (HOST_RESERVED_COLUMNS.has(column)) {
      fail(
        type,
        `field "${name}" projects to column "${column}", which the host owns on every entity row`,
      );
    }
  }
}

/** Rule 2 — the vocabulary is closed, and each entry must reference a real field. */
function checkIntegrity(
  type: string,
  schema: DataDeclaration['schema'],
  integrity: readonly IntegrityConstraint[],
): void {
  for (const constraint of integrity) {
    switch (constraint.kind) {
      case 'check': {
        const expr = constraint.expr;
        if (typeof expr !== 'string' || expr.trim() === '') {
          fail(type, 'integrity CHECK must carry a non-empty expression');
        }
        if (!CHECK_EXPR_ALLOWED_RE.test(expr) || expr.includes('--') || expr.includes('/*')) {
          fail(
            type,
            `integrity CHECK expression contains characters outside the allowed set (comparison, ` +
              `arithmetic, boolean connectives, quoted literals, parentheses): ${JSON.stringify(expr)}. ` +
              `The expression is interpolated into generated DDL and reaches a multi-statement ` +
              `\`db.exec\`, so it is allowlisted rather than blacklisted`,
          );
        }
        /**
         * The character allowlist bounds what the expression can EXPRESS; it
         * does not bound how many statements it produces. `(1)) ; CREATE TABLE x (a` passes
         * every character check while closing the CREATE early. Balanced
         * parentheses are what make the expression a single sub-expression of
         * the statement it is embedded in.
         */
        let depth = 0;
        for (const ch of expr) {
          if (ch === '(') depth += 1;
          else if (ch === ')') depth -= 1;
          if (depth < 0) break;
        }
        if (depth !== 0) {
          fail(
            type,
            `integrity CHECK expression has unbalanced parentheses: ${JSON.stringify(expr)}. An ` +
              `expression that closes more groups than it opens escapes the CREATE TABLE it is ` +
              `embedded in`,
          );
        }
        break;
      }
      case 'unique':
        if (!constraint.fields?.length) fail(type, 'integrity UNIQUE must name at least one field');
        for (const field of constraint.fields) {
          if (!(field in schema)) {
            fail(
              type,
              `integrity UNIQUE names "${field}", which is not a domain field of this type — ` +
                `uniqueness may only be declared over the type's own schema`,
            );
          }
        }
        break;
      case 'fk':
        if (!(constraint.field in schema)) {
          fail(type, `integrity FK names "${constraint.field}", which is not a field of this type`);
        }
        if (!constraint.references?.type) {
          fail(type, `integrity FK on "${constraint.field}" must name the referenced entity type`);
        }
        break;
      default:
        fail(
          type,
          `integrity constraint kind ${JSON.stringify((constraint as { kind: unknown }).kind)} is ` +
            `outside the closed vocabulary (check | unique | fk). An open slot here would be raw ` +
            `SQL by another name`,
        );
    }
  }
}

/**
 * Well-formedness of a step list, shared by `slugPattern` and `computedDefault`.
 *
 * 0.2.22 — one grammar means one validator. `slot` names the caller in every
 * message, because "reads a field that is not in the schema" needs to say WHICH
 * declaration is wrong before an author can fix it.
 */
function checkSteps(
  type: string,
  schema: DataDeclaration['schema'],
  pattern: SlugPattern,
  slot: string,
): void {
  const alternatives = alternativesOf(pattern);
  if (!alternatives.length || alternatives.some((a) => !a.length)) {
    fail(type, `${slot} must declare at least one non-empty alternative`);
  }
  for (const step of alternatives.flat()) {
    if (step.op === 'truncate' && (!Number.isInteger(step.n) || step.n <= 0)) {
      fail(type, `${slot} truncate(${String(step.n)}) must be a positive integer`);
    }
  }
  for (const field of slugPatternFields(pattern)) {
    const root = field.split('.')[0] ?? field;
    if (!(root in schema)) {
      fail(
        type,
        `${slot} reads field "${field}", which is not in the schema. A derivation reading a field ` +
          `that does not exist produces an empty value for every entity of the type`,
      );
    }
  }
}

/** The pattern must be well-formed AND must be able to produce a slug. */
function checkSlugPattern(type: string, schema: DataDeclaration['schema'], pattern: SlugPattern): void {
  checkSteps(type, schema, pattern, 'slugPattern');
  /**
   * A pattern reading only OPTIONAL fields yields `''` whenever the author omits
   * all of them — an entity with no slug, on a perfectly valid create. That has
   * to be impossible by construction rather than unlikely in practice.
   *
   * Two ways to be safe: end the chain in something total (`ac`'s `ac-`
   * literal), or read a field the schema marks `required`. Since 0.2.22 every
   * type satisfies the second by construction, because every pattern reads the
   * required `title` — but the check stays, since a plugin may derive its slug
   * from something else. A required field that slugifies to nothing — a title of
   * pure punctuation — is a write-path validation error, which is the correct
   * place for it: the payload is the problem, not the pattern.
   *
   * `nanoid(8)` used to be the other way to be total. It is gone from the
   * grammar, so the remaining escape is a literal.
   */
  const readsRequiredField = slugPatternFields(pattern).some(
    (field) => schema[field.split('.')[0] as string]?.required === true,
  );
  if (!slugPatternIsTotal(pattern) && !readsRequiredField) {
    fail(
      type,
      'slugPattern reads only optional fields, so a valid create can produce an empty slug — read a ' +
        'required field (`title` is required on every type), or end the chain with a literal prefix',
    );
  }
}

/**
 * The count filter must name a field that actually BECOMES A COLUMN.
 *
 * `compileDefaultPredicate` degrades to an unfiltered count when it cannot resolve
 * a field, which is right for a runtime read — a slightly-too-large badge beats
 * a blank sidebar. But degrading is the wrong answer for a manifest that is
 * simply wrong, and the degradation only covers fields absent from the schema:
 * a field that is PRESENT but not projected (`transientInput`, `localSurrogate`,
 * or a collection with its own table) resolves to a column name that does not
 * exist, and the count throws `no such column` out of the agent turn.
 *
 * Rejecting it here is the same trade the rest of this module makes: fail one
 * plugin at load rather than every chat turn at runtime.
 */
function checkDefaultPredicate(
  type: string,
  schema: DataDeclaration['schema'],
  predicate: DefaultPredicate | undefined,
): void {
  if (!predicate) return;
  if (typeof predicate.field !== 'string' || !predicate.field) {
    fail(type, 'systemPrompt.defaultPredicate must name a field');
  }
  const node = schema[predicate.field];
  if (!node) {
    fail(type, `systemPrompt.defaultPredicate names "${predicate.field}", which is not in the schema`);
  }
  if (!isEmbedded(node)) {
    fail(
      type,
      `systemPrompt.defaultPredicate names "${predicate.field}", which projects to no column ` +
        `(transient, local-surrogate, or a collection with its own table) — counting cannot filter ` +
        `on it`,
    );
  }
  if (predicate.eq === undefined && !predicate.in?.length) {
    fail(
      type,
      `systemPrompt.defaultPredicate on "${predicate.field}" declares neither \`eq\` nor a non-empty ` +
        `\`in\` — an empty predicate is expressed by omitting the slot`,
    );
  }
}

/**
 * The reserved `title` field — rejected on the SAME path as a missing
 * `data.schema`, which is the brief's own instruction and the right one: both
 * are "this manifest does not describe an entity this host can serve", and
 * splitting them into two severities would let a type load without the field
 * every renderer, every slug pattern and every identity lookup now reads.
 */
function checkReservedTitle(type: string, schema: DataDeclaration['schema']): void {
  const node = schema[RESERVED_TITLE_FIELD];
  if (!node) {
    fail(
      type,
      `the reserved \`${RESERVED_TITLE_FIELD}\` field is required in Host API 2.0.0 — declare ` +
        `\`${RESERVED_TITLE_FIELD}: { type: 'string', required: true, maxLength: ${TITLE_MAX_LENGTH} }\`. ` +
        `It is the single source of the entity's label, its slug and its identity search scope; ` +
        `derive it from another field with \`computedDefault\` when the author supplies none`,
    );
  }
  if (node.type !== 'string' || node.required !== true || node.maxLength !== TITLE_MAX_LENGTH) {
    fail(
      type,
      `the reserved \`${RESERVED_TITLE_FIELD}\` field must be declared exactly ` +
        `\`{ type: 'string', required: true, maxLength: ${TITLE_MAX_LENGTH} }\` — the bound is the ` +
        `HOST's, which is what makes "a title never needs shortening at read time" a fact`,
    );
  }
  if (node.contentBearing) {
    fail(type, `the reserved \`${RESERVED_TITLE_FIELD}\` field may not be contentBearing — it is the label`);
  }
}

/**
 * Value constraints, and the one place they may NOT appear.
 *
 * `maxLength` is a domain truth enforced on write. `data.integrity` drives
 * projection and DDL and explicitly excludes CHECK-shaped rules, so a length
 * bound expressed there would be a constraint the table tries to enforce and the
 * write path does not — two answers to one question.
 */
function checkValueConstraints(type: string, schema: DataDeclaration['schema']): void {
  walkSchema(schema, (path, node) => {
    if (node.type === 'string') {
      if (node.maxLength !== undefined && (!Number.isInteger(node.maxLength) || node.maxLength <= 0)) {
        fail(type, `field "${path}" declares maxLength ${String(node.maxLength)} — must be a positive integer`);
      }
      return;
    }
    if ((node as { maxLength?: number }).maxLength !== undefined) {
      fail(type, `field "${path}" declares maxLength on a ${node.type} leaf — it is a STRING constraint`);
    }
  });
}

/**
 * A derived `computedDefault` must read fields that exist, and must not chain.
 *
 * No chaining is the rule worth stating: derivation happens once, at create, in
 * one pass, so a default reading a field that is ITSELF derived would depend on
 * the order the host happened to resolve them in. Rejecting it is cheaper than
 * specifying an order nobody can see from the declaration.
 */
function checkComputedDefaults(type: string, schema: DataDeclaration['schema']): void {
  for (const [name, node] of Object.entries(schema)) {
    const computed = node.computedDefault;
    if (!computed || computed === 'now') continue;
    checkSteps(type, schema, computed, `field "${name}" computedDefault`);
    for (const field of slugPatternFields(computed)) {
      const root = field.split('.')[0] ?? field;
      if (root === name) {
        fail(type, `field "${name}" has a computedDefault reading itself`);
      }
      const source = schema[root];
      if (source?.computedDefault && source.computedDefault !== 'now') {
        fail(
          type,
          `field "${name}" has a computedDefault reading "${field}", which is itself computed — ` +
            `derivation is a single pass at create, so a chain would depend on resolution order`,
        );
      }
    }
  }
}

/**
 * A `contentBearing` field's content must be REACHABLE.
 *
 * The host generates `get_field_content` for every flagged field, so the default
 * always resolves. A type naming its own operation — the windowed-read pattern —
 * is checked against the operation catalog, because a field excluded from every
 * generic read with nothing behind it is write-only data.
 *
 * LIMIT worth stating: the catalog holds CORE operations. Plugin-contributed MCP
 * tools are declared as prose in `systemPrompt.mcpToolsLine` and never
 * registered, so a plugin naming one of its own tools here is accepted on the
 * strength of that line. Reported to the spec author — closing it properly means
 * plugins registering their tools in the catalog, which is a wider change than
 * this release scopes.
 */
function checkContentOperations(
  type: string,
  schema: DataDeclaration['schema'],
  mcpToolsLine: string | undefined,
): void {
  for (const [field, node] of Object.entries(schema)) {
    if (!node.contentBearing) continue;
    if (node.transientInput || node.localSurrogate) {
      fail(type, `field "${field}" is contentBearing and transient — there is no stored content to issue`);
    }
    const operation = node.contentOperation;
    if (!operation) continue;
    const known = CATALOG.has(operation) || (mcpToolsLine ?? '').includes(operation);
    if (!known) {
      fail(
        type,
        `field "${field}" names contentOperation "${operation}", which resolves to no operation. A ` +
          `content-bearing field is issued by no generic read, so an unreachable operation makes it ` +
          `write-only data. Known core operations: ${CATALOG.list()
            .map((op) => op.name)
            .join(', ')}`,
      );
    }
  }
}

/** Validate the whole `data` + `slugPattern` + `payloadVersion` triple. */
export function validateDataDeclaration(
  type: string,
  data: DataDeclaration | undefined,
  slugPattern: SlugPattern | undefined,
  payloadVersion: number | undefined,
  defaultPredicate?: DefaultPredicate,
  mcpToolsLine?: string,
): void {
  if (!data || typeof data !== 'object' || !data.schema || typeof data.schema !== 'object') {
    fail(type, 'the `data.schema` slot is required in Host API 2.0.0');
  }
  if (!Object.keys(data.schema).length) fail(type, 'the schema declares no fields');
  checkReservedTitle(type, data.schema);
  if (!slugPattern || !Array.isArray(slugPattern) || !slugPattern.length) {
    fail(type, 'the `slugPattern` slot is required in Host API 2.0.0');
  }
  if (!Number.isInteger(payloadVersion) || (payloadVersion as number) < 1) {
    fail(
      type,
      `the \`payloadVersion\` slot is required and must be a positive integer, got ` +
        `${JSON.stringify(payloadVersion)}`,
    );
  }

  checkNodes(type, data.schema);
  checkValueConstraints(type, data.schema);
  if (data.integrity?.length) checkIntegrity(type, data.schema, data.integrity);
  checkSlugPattern(type, data.schema, slugPattern);
  checkComputedDefaults(type, data.schema);
  checkContentOperations(type, data.schema, mcpToolsLine);
  checkDefaultPredicate(type, data.schema, defaultPredicate);

  for (const hint of data.access ?? []) {
    for (const field of [...(hint.filter ?? []), ...(hint.sort ? [hint.sort] : [])]) {
      if (!hint.collection && !(field in data.schema)) {
        fail(type, `data.access names field "${field}", which is not in the schema`);
      }
    }
  }
}

/*
 * 0.2.22 removed `assertContentBearingViews`.
 *
 * It rejected a type that declared its own `views?` alongside a `contentBearing`
 * field, on the grounds that the flag's meaning came from views the HOST
 * generates. That premise is gone: exclusion is now a property of the READ —
 * `project()` runs after serialization, over the schema, whoever computed the
 * payload — so a type computing its own views can no longer contradict the flag.
 *
 * The rule it is replaced by is `checkContentOperations` above: the content must
 * be REACHABLE. That is the half of the old pair which was never mechanically
 * enforced, and it is the half that mattered.
 */

/** Every `ref` flag in a schema → the payload path carrying it. Consumed by rename propagation (tier D). */
export function refFieldsOf(schema: DataDeclaration['schema']): Array<{ path: string; node: FieldNode }> {
  const out: Array<{ path: string; node: FieldNode }> = [];
  walkSchema(schema, (path, node) => {
    if (node.ref) out.push({ path, node });
  });
  return out;
}
