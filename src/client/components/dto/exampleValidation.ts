import type { DtoField } from '../../../shared/entities.js';

export interface ExampleFieldWarning {
  field: string;
  expected: string;
  got: string;
}

export function validateExampleAgainstFields(
  value: unknown,
  fields: DtoField[],
): ExampleFieldWarning[] {
  if (!fields.length) return [];
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return [{ field: '<root>', expected: 'object', got: describe(value) }];
  }
  const obj = value as Record<string, unknown>;
  const warnings: ExampleFieldWarning[] = [];
  for (const f of fields) {
    const present = Object.prototype.hasOwnProperty.call(obj, f.name);
    if (f.required && !present) {
      warnings.push({ field: f.name, expected: f.type, got: 'missing' });
      continue;
    }
    if (!present) continue;
    const v = obj[f.name];
    if (v === null) continue;
    const expected = baseType(f.type);
    const got = describe(v);
    if (expected && got !== expected && expected !== 'any') {
      warnings.push({ field: f.name, expected: f.type, got });
    }
  }
  return warnings;
}

function baseType(rawType: string): string {
  const t = rawType.replace(/\[\]$/, '').trim().toLowerCase();
  if (rawType.endsWith('[]')) return 'array';
  if (['string', 'number', 'boolean', 'object', 'array', 'any'].includes(t)) return t;
  return '';
}

function describe(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

export function buildExampleTemplate(fields: DtoField[]): unknown {
  if (!fields.length) return {};
  const obj: Record<string, unknown> = {};
  for (const f of fields) {
    obj[f.name] = defaultForType(f.type);
  }
  return obj;
}

function defaultForType(t: string): unknown {
  if (t.endsWith('[]')) return [];
  const lower = t.trim().toLowerCase();
  if (lower === 'string') return '';
  if (lower === 'number' || lower === 'integer') return 0;
  if (lower === 'boolean') return false;
  if (lower === 'object') return {};
  return null;
}
