import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { tagsApi } from '../lib/api.js';
import { createTagIdempotent } from '../runtime/tags-service.js';
import type { EntityType } from '../../shared/entities.js';

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
