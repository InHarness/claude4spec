import { confirmDestructive, toast } from '@c4s/plugin-runtime';

/**
 * 2.1.16 — the `endpoint-delete` window, asked from the detail ROUTE's toolbar
 * (M13 detail pattern: the route renders breadcrumb, view switcher and Delete;
 * the panel carries no Delete of its own).
 *
 * The confirmation goes through the shell's `confirmDestructive` facade of
 * `@c4s/plugin-runtime` — the plugin emits no host event of its own.
 */
export function deleteEndpointBody(title: string): string {
  return `Delete ${title}? All references to this endpoint will become broken.`;
}

/**
 * Ask, then delete. Answers whether the endpoint is gone. `remove` is the
 * caller's delete mutation, so the shared query cache is invalidated.
 */
export async function confirmAndDeleteEndpoint(
  endpoint: { slug: string; title: string },
  remove: (slug: string) => Promise<unknown>,
): Promise<boolean> {
  const ok = await confirmDestructive('endpoint-delete', {
    title: 'Delete endpoint?',
    body: deleteEndpointBody(endpoint.title),
    confirmLabel: 'Delete',
  });
  if (!ok) return false;
  try {
    await remove(endpoint.slug);
    toast.success('Endpoint deleted');
    return true;
  } catch (err) {
    toast.error((err as Error).message);
    return false;
  }
}
