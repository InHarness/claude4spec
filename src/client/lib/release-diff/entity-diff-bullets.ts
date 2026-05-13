/**
 * Generic mapper EntityDiff → Bullet[] (M17 L5, m17ui002).
 *
 * Konsumuje pole `changes` z `RawDeltaEntityChange` i mapuje po konwencji
 * nazw pól używanej dziś przez wszystkie 4 plugin-serializery encji
 * (endpoint, dto, database-table, ui-view). Per-plugin formatter może
 * zostać dorobiony jako extension point — patrz otwarte pytanie #5
 * w m17-snapshots-releases.md.
 *
 * Konwencje (suffix-based):
 *   `*_added`     → Bullet[] kind: 'add'
 *   `*_removed`   → Bullet[] kind: 'remove'
 *   `*_modified`  → Bullet[] kind: 'modify'
 *   `*_changed`   → Bullet[] kind: 'modify' z `from`/`to`
 *
 * Specjalne pola:
 *   `field_changes`, `meta_changes` — Array<{field, from, to}> →
 *     bullet 'modify' per field
 *   `status_code_changed` (Endpoint) — Array<{dto_slug, relation, from, to}> →
 *     bullet 'modify' per relation z labelką
 *
 * Nieznane klucze: fallback bullet 'modify' z labelką = nazwa klucza.
 */

export type BulletKind = 'add' | 'modify' | 'remove';

export interface Bullet {
  kind: BulletKind;
  /** Human-friendly etykieta np. `method`, `linked_dtos[user-create]`, `tags[admin]` */
  label: string;
  from?: unknown;
  to?: unknown;
}

interface FieldChange {
  field: string;
  from: unknown;
  to: unknown;
}

export function entityDiffToBullets(
  changes: Record<string, unknown> | undefined,
): Bullet[] {
  if (!changes) return [];
  const bullets: Bullet[] = [];

  for (const [key, value] of Object.entries(changes)) {
    if (key === 'field_changes' || key === 'meta_changes') {
      bullets.push(...fieldChangesToBullets(value));
      continue;
    }
    if (key === 'status_code_changed') {
      bullets.push(...statusCodeChangedToBullets(value));
      continue;
    }
    if (key.endsWith('_added')) {
      const category = key.slice(0, -'_added'.length);
      bullets.push(...listToBullets(value, 'add', category));
      continue;
    }
    if (key.endsWith('_removed')) {
      const category = key.slice(0, -'_removed'.length);
      bullets.push(...listToBullets(value, 'remove', category));
      continue;
    }
    if (key.endsWith('_modified')) {
      const category = key.slice(0, -'_modified'.length);
      bullets.push(...modifiedListToBullets(value, category));
      continue;
    }
    if (key.endsWith('_changed')) {
      const category = key.slice(0, -'_changed'.length);
      bullets.push(...changedToBullets(value, category));
      continue;
    }
    // Unknown key fallback
    bullets.push({ kind: 'modify', label: key, to: value });
  }

  return bullets;
}

function fieldChangesToBullets(value: unknown): Bullet[] {
  if (!Array.isArray(value)) return [];
  const out: Bullet[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const fc = item as FieldChange;
    if (typeof fc.field !== 'string') continue;
    out.push({ kind: 'modify', label: fc.field, from: fc.from, to: fc.to });
  }
  return out;
}

function statusCodeChangedToBullets(value: unknown): Bullet[] {
  if (!Array.isArray(value)) return [];
  const out: Bullet[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const dto = String(o.dto_slug ?? '');
    const rel = String(o.relation ?? '');
    out.push({
      kind: 'modify',
      label: `status_code[${rel}:${dto}]`,
      from: o.from,
      to: o.to,
    });
  }
  return out;
}

function listToBullets(value: unknown, kind: BulletKind, category: string): Bullet[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => ({
    kind,
    label: `${category}[${labelOfItem(item)}]`,
    ...(kind === 'add' ? { to: item } : { from: item }),
  }));
}

function modifiedListToBullets(value: unknown, category: string): Bullet[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => ({
    kind: 'modify',
    label: `${category}[${labelOfItem(item)}]`,
    to: item,
  }));
}

function changedToBullets(value: unknown, category: string): Bullet[] {
  // Single { from, to } object — most common shape for `*_changed`
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const o = value as Record<string, unknown>;
    if ('from' in o || 'to' in o) {
      return [{ kind: 'modify', label: category, from: o.from, to: o.to }];
    }
  }
  // Array of { from, to } shapes — fallback per item
  if (Array.isArray(value)) {
    return value.map((item) => ({
      kind: 'modify',
      label: `${category}[${labelOfItem(item)}]`,
      from: (item as Record<string, unknown>)?.from,
      to: (item as Record<string, unknown>)?.to,
    }));
  }
  return [{ kind: 'modify', label: category, to: value }];
}

/** Pick a short identifier from a list-item object (slug/name/id, else stringify). */
function labelOfItem(item: unknown): string {
  if (item == null) return '';
  if (typeof item === 'string' || typeof item === 'number') return String(item);
  if (typeof item === 'object') {
    const o = item as Record<string, unknown>;
    for (const key of ['slug', 'dto_slug', 'name', 'anchor', 'id', 'path', 'field']) {
      if (typeof o[key] === 'string' || typeof o[key] === 'number') {
        return String(o[key]);
      }
    }
  }
  return JSON.stringify(item).slice(0, 40);
}
