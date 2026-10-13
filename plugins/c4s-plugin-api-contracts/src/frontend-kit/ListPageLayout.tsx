/**
 * DEBT (2.1.20, Host UI Kit slice of `c4s-plugin-api-contracts`, endpoint + dto): `ListPageLayout`, the list page
 * layout. It fails the locality rule — each of three plugin packages keeps its
 * own copy (condition 1), and the list page layout is common to every entity
 * type (condition 2). The catalog has no component that replaces it; it is a
 * candidate of the catalog trajectory (M34). Recorded, not fixed here.
 *
 * `EntityListLayout` (kit) frames the SCROLLING REGION of a list; nothing in the
 * catalog frames the page around it, which is what this one line does.
 */
export function ListPageLayout({ children }: { children: React.ReactNode }) {
  return <div className="flex-1 flex flex-col min-h-0 overflow-hidden">{children}</div>;
}
