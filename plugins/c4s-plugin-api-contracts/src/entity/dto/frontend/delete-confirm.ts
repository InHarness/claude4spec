import { confirmDestructive, toast } from '@c4s/plugin-runtime';

/**
 * 2.1.16 — the `dto-delete` window, asked from the detail ROUTE's toolbar (M13
 * detail pattern: the route renders breadcrumb, view switcher and Delete; the
 * panel carries no Delete of its own).
 *
 * The confirmation goes through the shell's `confirmDestructive` facade of
 * `@c4s/plugin-runtime` — the plugin emits no host event of its own.
 */
export function deleteDtoBody(title: string): string {
  return `Delete DTO ${title}? All references to this DTO will become broken.`;
}

/**
 * Ask, then delete. Answers whether the DTO is gone. `remove` is the caller's
 * delete mutation, so the shared query cache is invalidated.
 */
export async function confirmAndDeleteDto(
  dto: { slug: string; title: string },
  remove: (slug: string) => Promise<unknown>,
): Promise<boolean> {
  const ok = await confirmDestructive('dto-delete', {
    title: 'Delete DTO?',
    body: deleteDtoBody(dto.title),
    confirmLabel: 'Delete',
  });
  if (!ok) return false;
  try {
    await remove(dto.slug);
    toast.success('DTO deleted');
    return true;
  } catch (err) {
    toast.error((err as Error).message);
    return false;
  }
}
