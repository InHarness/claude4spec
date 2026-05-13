-- Wykluczenie briefów z release snapshot. Wcześniej `page_version` nie miała
-- dyskryminatora między stronami (pagesDir) a briefami (briefsDir) — `path`
-- jest relatywny do swojego rootDir, więc filtr po prefixie nie działa.
-- Spec: modules/m17-snapshots-releases.md (m17top001), modules/m21-briefs.md (m21db0001).

ALTER TABLE page_version
  ADD COLUMN kind TEXT NOT NULL DEFAULT 'page'
  CHECK (kind IN ('page','brief'));

-- Backfill po frontmatter.type w polu data (JSON snapshot).
-- Tombstone'y op='delete' z pustym frontmatter zostają jako 'page' — akceptowalne
-- (rzadkie, łatwe do ręcznej korekty jeśli wystąpią; brief 'delete' tombstone
--  ma frontmatter z poprzedniej wersji bo synthesizeDeleteFromLastVersion
--  klonuje ostatni snapshot).
UPDATE page_version
SET kind = 'brief'
WHERE json_extract(data, '$.frontmatter.type') = 'brief';

-- Odpięcie historycznych briefów od release'ów do których wpadły przed fixem.
-- Nowy kontrakt: żaden release nie zawiera briefów (ani nowy, ani legacy).
UPDATE page_version
SET release_id = NULL
WHERE kind = 'brief';

CREATE INDEX IF NOT EXISTS idx_page_version_kind_release
  ON page_version (kind, release_id);
