/**
 * HOST-LOCAL — a bare flex frame the catalog does not publish.
 *
 * `EntityListLayout` (kit) frames the SCROLLING REGION of a list; nothing in the
 * catalog frames the page around it, which is what this one line does. Copying
 * would be the wrong word for it — there is no catalog component with this
 * anatomy to copy. It disappears the moment the kit grows a page-level shell.
 */

export function ListPageLayout({ children }: { children: React.ReactNode }) {
  return <div className="flex-1 flex flex-col min-h-0 overflow-hidden">{children}</div>;
}
