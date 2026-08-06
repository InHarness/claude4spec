/**
 * SQL reserved words, maintained by the HOST rather than deferred to SQLite.
 *
 * SQLite would happily accept most of these when quoted, which is the problem:
 * the projection generator emits bare identifiers, and a column called `order`
 * or `default` produces a syntax error at `CREATE TABLE` time — at boot, inside
 * a transaction, from a manifest that passed registration. Rejecting the name up
 * front turns that into a load failure with the field name in the message.
 *
 * IT LIVES IN `shared/` FOR A SECOND READER. `data-schema-validation` screens
 * the identifiers the host DERIVES (column names); `ScalarNode.notReserved`
 * screens a VALUE a caller supplies, for a type whose payload field becomes an
 * identifier somewhere the host cannot see — `database-table.name` is a real SQL
 * table name in someone else's schema.
 *
 * One list, because two would drift: a type transcribing its own copy stops
 * agreeing with the host on the first keyword the host adds, and the
 * disagreement shows up as a name accepted by one layer and rejected by the
 * other.
 */
export const SQL_RESERVED_WORDS: ReadonlySet<string> = new Set([
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
