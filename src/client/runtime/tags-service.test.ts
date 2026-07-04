import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ApiError } from '../lib/api.js';
import type { Tag } from '../../shared/entities.js';

const create = vi.fn();
const getBySlug = vi.fn();

vi.mock('../lib/api.js', async () => {
  const actual = await vi.importActual<typeof import('../lib/api.js')>('../lib/api.js');
  return {
    ...actual,
    tagsApi: { ...actual.tagsApi, create: (...args: unknown[]) => create(...args), getBySlug: (...args: unknown[]) => getBySlug(...args) },
  };
});

const { createTagIdempotent } = await import('./tags-service.js');

function conflict(slug: string): ApiError {
  return new ApiError('SLUG_CONFLICT', `tag slug '${slug}' already exists`, 409);
}

describe('createTagIdempotent', () => {
  beforeEach(() => {
    create.mockReset();
    getBySlug.mockReset();
  });

  it('returns the newly created tag when the slug is free', async () => {
    const tag: Tag = { slug: 'billing', name: 'Billing', color: null, description: null, counts: {}, createdAt: '', updatedAt: '' };
    create.mockResolvedValue(tag);

    const result = await createTagIdempotent('Billing');

    expect(result).toBe(tag);
    expect(getBySlug).not.toHaveBeenCalled();
  });

  it('looks the existing tag up by its SLUGIFIED name on conflict, not raw string equality', async () => {
    const existing: Tag = { slug: 'billing', name: 'Billing', color: null, description: null, counts: {}, createdAt: '', updatedAt: '' };
    create.mockRejectedValue(conflict('billing'));
    getBySlug.mockResolvedValue(existing);

    // Different case AND trailing whitespace — a strict `name === input` (or
    // `slug === input`) comparison would fail to recognize this as the same tag.
    const result = await createTagIdempotent('BILLING ');

    expect(getBySlug).toHaveBeenCalledWith('billing');
    expect(result).toBe(existing);
  });

  it('slugifies multi-word input the same way the backend does (spaces to dashes)', async () => {
    const existing: Tag = { slug: 'client-billing', name: 'Client Billing', color: null, description: null, counts: {}, createdAt: '', updatedAt: '' };
    create.mockRejectedValue(conflict('client-billing'));
    getBySlug.mockResolvedValue(existing);

    const result = await createTagIdempotent('client billing');

    expect(getBySlug).toHaveBeenCalledWith('client-billing');
    expect(result).toBe(existing);
  });

  it('rethrows the original conflict if the follow-up lookup unexpectedly fails', async () => {
    const original = conflict('billing');
    create.mockRejectedValue(original);
    getBySlug.mockRejectedValue(new ApiError('NOT_FOUND', 'tag not found', 404));

    await expect(createTagIdempotent('Billing')).rejects.toBe(original);
  });

  it('rethrows non-conflict errors without attempting a lookup', async () => {
    const validationError = new ApiError('VALIDATION', 'tag name produces empty slug', 400);
    create.mockRejectedValue(validationError);

    await expect(createTagIdempotent('   ')).rejects.toBe(validationError);
    expect(getBySlug).not.toHaveBeenCalled();
  });
});
