import type { ComponentType } from 'react';
import type { EntityCardProps } from './registry.js';
import { useRefLookup } from './useRefLookup.js';

/**
 * 2.1.41 — the host's one way of rendering a `renderCard` slot: it builds the
 * card's `refLookup` for its one entity (`useRefLookup`) and hands it in. Every
 * host call site (the `single_element` embed, the chat tool card, the release
 * diff cards) goes through here, so none of them can forget the prop.
 */
export function HostCard<T>({
  type,
  card: Card,
  ...props
}: Omit<EntityCardProps<T>, 'refLookup'> & { type: string; card: ComponentType<EntityCardProps<T>> }) {
  const refLookup = useRefLookup(type, props.entity != null ? [props.entity] : []);
  return <Card {...(props as Omit<EntityCardProps<T>, 'refLookup'>)} refLookup={refLookup} />;
}
