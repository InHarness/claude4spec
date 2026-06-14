/**
 * Adapter snapshot → entity-shape (M17 m17uidet01).
 *
 * Mapuje `EntitySnapshot` (z `releaseService.getReleaseSnapshot()`) na
 * shape oczekiwany przez `EntityDef.renderCard` per typ encji. Pola które
 * snapshot pomija (createdAt/updatedAt/junction tables) są wypełniane
 * stub'ami — Card komponenty ich nie czytają (zweryfikowane w plugin.tsx
 * dla każdej z 4 encji).
 *
 * Używane do renderu stanu `from` w cards z `op === 'deleted'` (encja już
 * nie istnieje w bieżącym DB, więc useGetBySlug nie zadziała).
 */

import type {
  Endpoint,
  Dto,
  DatabaseTable,
  UiView,
} from '../../../shared/entities.js';

export function snapshotToEntity(type: string, data: unknown): unknown | null {
  if (data == null || typeof data !== 'object') return null;
  const s = data as Record<string, unknown>;
  switch (type) {
    case 'endpoint':
      return snapshotToEndpoint(s);
    case 'dto':
      return snapshotToDto(s);
    case 'database-table':
      return snapshotToDatabaseTable(s);
    case 'ui-view':
      return snapshotToUiView(s);
    default:
      return null;
  }
}

function snapshotToEndpoint(s: Record<string, unknown>): Endpoint {
  return {
    slug: String(s.slug ?? ''),
    method: (s.method as Endpoint['method']) ?? 'GET',
    path: String(s.path ?? ''),
    summary: typeof s.summary === 'string' ? s.summary : '',
    description: (s.description as string | null) ?? null,
    tags: Array.isArray(s.tags) ? (s.tags as string[]) : [],
    dtos: [],
    createdAt: '',
    updatedAt: '',
  };
}

function snapshotToDto(s: Record<string, unknown>): Dto {
  return {
    slug: String(s.slug ?? ''),
    name: String(s.name ?? ''),
    description: (s.description as string | null) ?? null,
    fields: Array.isArray(s.fields) ? (s.fields as Dto['fields']) : [],
    examples: Array.isArray(s.examples) ? (s.examples as Dto['examples']) : [],
    tags: Array.isArray(s.tags) ? (s.tags as string[]) : [],
    endpoints: [],
    createdAt: '',
    updatedAt: '',
  };
}

function snapshotToDatabaseTable(s: Record<string, unknown>): DatabaseTable {
  return {
    slug: String(s.slug ?? ''),
    name: String(s.name ?? ''),
    description: (s.description as string | null) ?? null,
    columns: Array.isArray(s.columns) ? (s.columns as DatabaseTable['columns']) : [],
    indexes: Array.isArray(s.indexes) ? (s.indexes as DatabaseTable['indexes']) : [],
    tags: Array.isArray(s.tags) ? (s.tags as string[]) : [],
    createdAt: '',
    updatedAt: '',
  };
}

function snapshotToUiView(s: Record<string, unknown>): UiView {
  return {
    slug: String(s.slug ?? ''),
    name: String(s.name ?? ''),
    url: (s.url as string | null) ?? null,
    description: (s.description as string | null) ?? null,
    params: Array.isArray(s.params) ? (s.params as UiView['params']) : [],
    designSystemSlug:
      typeof s.designSystemSlug === 'string' && s.designSystemSlug ? s.designSystemSlug : null,
    tags: Array.isArray(s.tags) ? (s.tags as string[]) : [],
    createdAt: '',
    updatedAt: '',
  };
}
