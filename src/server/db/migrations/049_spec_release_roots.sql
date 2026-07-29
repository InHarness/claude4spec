-- 0.2.2 (brief §8, M29): `spec_release` becomes FULLY reconstructable from
-- `<releasesDir>/<slug>.json`.
--
-- 0.1.118 already made the release IDENTITY a derived cache rebuilt from those
-- files, but the rebuild only restored name/slug/description/created_by/created_at
-- — `roots` existed in the JSON file and had nowhere to land in the DB. A rebuilt
-- database therefore came back with releases whose releasable-root set was lost,
-- silently falling back to the project's CURRENT roots when diffing an old release.
--
-- Stored as a JSON array of root ids (TEXT), matching `ReleaseFileData.roots`.
-- NULL means "no roots recorded" — the pre-0.2.2 rows and any release whose file
-- predates this column — and callers fall back to the current releasable roots
-- exactly as they did before, so no existing installation changes behaviour.
--
-- What remains deliberately NON-reconstructable is unchanged: `entity_version` /
-- `file_version` and the `release_id` linkage live exclusively in SQLite.

ALTER TABLE spec_release ADD COLUMN roots TEXT;
