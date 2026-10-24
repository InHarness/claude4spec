-- 2.1.47 (M17 m17reldisk / L1 34xy2eei): a release created by accepting a shadow
-- remembers WHICH shadow it accepted — the shadow id (the ref name without the
-- `refs/runs/` prefix) and the SHA of the tip that was previewed and merged.
--
-- Both columns are NULL for every release that does not accept a shadow — every
-- existing row, every plain `createRelease`, and every release file without the
-- `acceptedShadow` field. They are release METADATA, reconstructable like the rest
-- of it: the boot reindex (M29 m29idx001) copies them from the file's
-- `acceptedShadow` (`{ id, tipSha }`), so no data migration is needed here.

ALTER TABLE spec_release ADD COLUMN accepted_shadow_id TEXT;
ALTER TABLE spec_release ADD COLUMN accepted_shadow_sha TEXT;
