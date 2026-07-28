import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { tagsApi } from '../lib/api.js';
import { createTagIdempotent } from '../runtime/tags-service.js';
import type { EntityType, Tag, TagUpdateInput } from '../../shared/entities.js';

const entityTagsKey = (type: EntityType, slug: string) => ['entity-tags', type, slug] as const;

export function useTags() {
  return useQuery({
    queryKey: ['tags'],
    queryFn: () => tagsApi.list(),
  });
}

/** M34/L11: tags assigned to one entity. */
export function useEntityTags(type: EntityType, slug: string | null) {
  return useQuery({
    queryKey: slug ? entityTagsKey(type, slug) : ['entity-tags', type, 'none'],
    queryFn: () => tagsApi.getEntityTags(type, slug as string),
    enabled: Boolean(slug),
  });
}

/** M34/L11: idempotent — a name resolving to an existing slug is a no-op. */
export function useCreateTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createTagIdempotent,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tags'] }),
  });
}

/**
 * M18: inline edit of a tag's own fields (name, color) from `/tags`. Optimistic
 * — the row must not flicker back to the old value while the PATCH is in
 * flight — with the server response reconciled on settle.
 *
 * A rename re-derives the slug server-side, and the slug is the mutation's own
 * addressing key. So the server's tag replaces the optimistic row on success:
 * carrying the stale slug forward would send the NEXT edit of that row (a
 * colour pick moments later) to a path that no longer exists.
 */
export function useUpdateTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, input }: { slug: string; input: TagUpdateInput }) =>
      tagsApi.update(slug, input),
    onMutate: async ({ slug, input }) => {
      await qc.cancelQueries({ queryKey: ['tags'] });
      const previous = qc.getQueryData<Tag[]>(['tags']);
      qc.setQueryData<Tag[]>(['tags'], (old) =>
        old?.map((t) => (t.slug === slug ? { ...t, ...input } : t)),
      );
      return { previous };
    },
    onSuccess: (updated, { slug }) => {
      qc.setQueryData<Tag[]>(['tags'], (old) =>
        old?.map((t) => (t.slug === slug ? updated : t)),
      );
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) qc.setQueryData(['tags'], context.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['tags'] }),
  });
}

export function useAssignTags() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ type, slug, tags }: { type: EntityType; slug: string; tags: string[] }) =>
      tagsApi.assign(type, slug, tags),
    onSuccess: (_data, { type, slug }) => {
      qc.invalidateQueries({ queryKey: ['tags'] });
      qc.invalidateQueries({ queryKey: entityTagsKey(type, slug) });
    },
  });
}

/** M34/L11: removes ONE tag without touching the entity's other tags. */
export function useRemoveEntityTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ type, slug, tagSlug }: { type: EntityType; slug: string; tagSlug: string }) =>
      tagsApi.removeEntityTag(type, slug, tagSlug),
    onSuccess: (_data, { type, slug }) => {
      qc.invalidateQueries({ queryKey: ['tags'] });
      qc.invalidateQueries({ queryKey: entityTagsKey(type, slug) });
    },
  });
}
