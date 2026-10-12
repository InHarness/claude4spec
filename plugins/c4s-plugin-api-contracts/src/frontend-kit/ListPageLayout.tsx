// ASSUMPTION:dev-1907 — the 2.1.19 api-contracts slice lists `ListPageHeader`
// and `ListScrollArea` as DEBT of this package; neither stands here. The
// endpoint and dto lists already compose their catalog replacements
// (`EntityListHeader`, `EntityListLayout`, `LoadingState`, `EmptyState`)
// directly; this bare flex frame is not in the slice's host-local list and is
// kept as it is.
export function ListPageLayout({ children }: { children: React.ReactNode }) {
  return <div className="flex-1 flex flex-col min-h-0 overflow-hidden">{children}</div>;
}
