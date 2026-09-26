/**
 * Shared rules for "create the missing page" flows (App's new-page action, the
 * links list, the broken `@path` chip popover): which paths may be created as a
 * page, and the H1 a fresh page starts with.
 */
export function canCreatePage(filePath: string): boolean {
  return filePath.toLowerCase().endsWith('.md');
}

export function deriveTitle(filePath: string): string {
  const base = filePath.split('/').pop() ?? 'untitled';
  return base.replace(/\.md$/, '').replaceAll('-', ' ');
}
