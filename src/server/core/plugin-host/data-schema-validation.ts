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
 */

import {
  MAX_PROJECTION_DEPTH,
  columnOf,
  hasProjectionTable,
  isEmbedded,
  walkSchema,
  type CollectionNode,
  type CountPredicate,
  type DataDeclaration,
  type FieldNode,
  type IntegrityConstraint,
} from '../../../shared/plugin-host/data-schema.js';
import {
  alternativesOf,
  slugPatternFields,
  slugPatternIsTotal,
  type SlugPattern,
} from '../../../shared/plugin-host/slug-pattern.js';
import { PluginManifestError } from './manifest-adapter.js';

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
 * SQL reserved words, maintained by the HOST rather than deferred to SQLite.
 *
 * SQLite would happily accept most of these when quoted, which is the problem:
 * the projection generator emits bare identifiers, and a column called `order`
 * or `default` produces a syntax error at `CREATE TABLE` time — at boot, inside
 * a transaction, from a manifest that passed registration. Rejecting the name up
 * front turns that into a load failure with the field name in the message.
 */
const RESERVED_WORDS: ReadonlySet<string> = new Set([
  'abort', 'action', 'add', 'after', 'all', 'alter', 'analyze', 'and', 'as', 'asc',
  'attach', 'autoincrement', 'before', 'begin', 'between', 'by', 'cascade', 'case',
  'cast', 'check', 'collate', 'column', 'commit', 'conflict', 'constraint', 'create',
  'cross', 'current_date', 'current_time', 'current_timestamp', 'database', 'default',
  'deferrable', 'deferred', 'delete', 'desc', 'detach', 'distinct', 'drop', 'each',
  'else', 'end', 'escape', 'except', 'exclusive', 'exists', 'explain', 'fail', 'for',
  'foreign', 'from', 'full', 'glob', 'group', 'having', 'if', 'ignore', 'immediate',
  'in', 'index', 'indexed', 'initially', 'inner', 'insert', 'instead', 'intersect',
  'into', 'is', 'isnull', 'join', 'key', 'left', 'like', 'limit', 'match', 'natural',
  'no', 'not', 'notnull', 'null', 'of', 'offset', 'on', 'or', 'order', 'outer',
  'plan', 'pragma', 'primary', 'query', 'raise', 'references', 'regexp', 'reindex',
  'release', 'rename', 'replace', 'restrict', 'right', 'rollback', 'row', 'savepoint',
  'select', 'set', 'table', 'temp', 'temporary', 'then', 'to', 'transaction',
  'trigger', 'union', 'unique', 'update', 'using', 'vacuum', 'values', 'view',
  'virtual', 'when', 'where', 'with', 'without',
]);

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
    if (node.kind === 'collection') {
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
        if (node.item.kind !== 'object') {
          fail(type, `collection "${path}" declares keyFields but its item is not an object`);
        } else {
          for (const key of node.keyFields) {
            if (!(key in node.item.fields)) {
              fail(type, `collection "${path}" keyField "${key}" is not a field of its item`);
            }
          }
        }
      }
    }
    if (node.kind === 'record' && node.value.kind === 'collection') {
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
      item.kind === 'object' ? Object.entries(item.fields) : [['value', item]];
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

/** The pattern must be well-formed AND must be able to produce a slug. */
function checkSlugPattern(type: string, schema: DataDeclaration['schema'], pattern: SlugPattern): void {
  const alternatives = alternativesOf(pattern);
  if (!alternatives.length || alternatives.some((a) => !a.length)) {
    fail(type, 'slugPattern must declare at least one non-empty alternative');
  }
  for (const step of alternatives.flat()) {
    if (step.op === 'truncate' && (!Number.isInteger(step.n) || step.n <= 0)) {
      fail(type, `slugPattern truncate(${String(step.n)}) must be a positive integer`);
    }
    if (step.op === 'nanoid' && (!Number.isInteger(step.n) || step.n <= 0)) {
      fail(type, `slugPattern nanoid(${String(step.n)}) must be a positive integer`);
    }
  }
  for (const field of slugPatternFields(pattern)) {
    const root = field.split('.')[0] ?? field;
    if (!(root in schema)) {
      fail(
        type,
        `slugPattern reads field "${field}", which is not in the schema. A pattern reading a field ` +
          `that does not exist produces an empty slug for every entity of the type`,
      );
    }
  }
  /**
   * A pattern reading only OPTIONAL fields yields `''` whenever the author omits
   * all of them — an entity with no slug, on a perfectly valid create. That has
   * to be impossible by construction rather than unlikely in practice.
   *
   * Two ways to be safe, and the six built-in types split across both: end the
   * chain in something total (`ac`'s `ac-` literal, `diagram`'s `nanoid(8)`), or
   * read a field the schema marks `required` (`dto`/`ui-view`/`design-system`
   * slugify `name`, `endpoint` reads `method` and `path`). A required field that
   * slugifies to nothing — a name of pure punctuation — is a write-path
   * validation error, which is the correct place for it: the payload is the
   * problem, not the pattern.
   */
  const readsRequiredField = slugPatternFields(pattern).some(
    (field) => schema[field.split('.')[0] as string]?.required === true,
  );
  if (!slugPatternIsTotal(pattern) && !readsRequiredField) {
    fail(
      type,
      'slugPattern reads only optional fields, so a valid create can produce an empty slug — read a ' +
        'required field, or end the chain with a literal prefix or a nanoid(n) alternative',
    );
  }
}

/**
 * The count filter must name a field that actually BECOMES A COLUMN.
 *
 * `compileCountPredicate` degrades to an unfiltered count when it cannot resolve
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
function checkCountPredicate(
  type: string,
  schema: DataDeclaration['schema'],
  predicate: CountPredicate | undefined,
): void {
  if (!predicate) return;
  if (typeof predicate.field !== 'string' || !predicate.field) {
    fail(type, 'systemPrompt.countPredicate must name a field');
  }
  const node = schema[predicate.field];
  if (!node) {
    fail(type, `systemPrompt.countPredicate names "${predicate.field}", which is not in the schema`);
  }
  if (!isEmbedded(node)) {
    fail(
      type,
      `systemPrompt.countPredicate names "${predicate.field}", which projects to no column ` +
        `(transient, local-surrogate, or a collection with its own table) — counting cannot filter ` +
        `on it`,
    );
  }
  if (predicate.eq === undefined && !predicate.in?.length) {
    fail(
      type,
      `systemPrompt.countPredicate on "${predicate.field}" declares neither \`eq\` nor a non-empty ` +
        `\`in\` — an empty predicate is expressed by omitting the slot`,
    );
  }
}

/** Validate the whole `data` + `slugPattern` + `payloadVersion` triple. */
export function validateDataDeclaration(
  type: string,
  data: DataDeclaration | undefined,
  slugPattern: SlugPattern | undefined,
  payloadVersion: number | undefined,
  countPredicate?: CountPredicate,
): void {
  if (!data || typeof data !== 'object' || !data.schema || typeof data.schema !== 'object') {
    fail(type, 'the `data.schema` slot is required in Host API 2.0.0');
  }
  if (!Object.keys(data.schema).length) fail(type, 'the schema declares no fields');
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
  if (data.integrity?.length) checkIntegrity(type, data.schema, data.integrity);
  checkSlugPattern(type, data.schema, slugPattern);
  checkCountPredicate(type, data.schema, countPredicate);

  for (const hint of data.access ?? []) {
    for (const field of [...(hint.filter ?? []), ...(hint.sort ? [hint.sort] : [])]) {
      if (!hint.collection && !(field in data.schema)) {
        fail(type, `data.access names field "${field}", which is not in the schema`);
      }
    }
  }
}

/** Every `ref` flag in a schema → the payload path carrying it. Consumed by rename propagation (tier D). */
export function refFieldsOf(schema: DataDeclaration['schema']): Array<{ path: string; node: FieldNode }> {
  const out: Array<{ path: string; node: FieldNode }> = [];
  walkSchema(schema, (path, node) => {
    if (node.ref) out.push({ path, node });
  });
  return out;
}
