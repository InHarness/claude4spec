# u09 — non-blocking findings (round 1)

- **rev-0001** `src/client/components/CreateProjectPage.tsx:39` — dead re-export of PROJECT_TYPES_QUERY_KEY; fetchProjectTypes exported but used only locally.
