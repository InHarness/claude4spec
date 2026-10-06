-- 2.1.8 (M17): `file_version.rootId` names a ROOT REGISTRY entry.
--
-- Briefs, patches and plans became system roots whose id equals their kind
-- (`briefs`, `patches`, `plans`). Their rows carried the bare markers `brief`,
-- `patch`, `plan`, which never addressed a space; after this remap every value
-- points at a registry entry: page rows keep `root.id`, artifact rows get the
-- system root's id.
--
-- One-time and idempotent: a second run finds no old marker and changes nothing.
-- The column stays dynamic (no enum, no CHECK) and the unique index
-- `uq_file_version_path_root_version` on (path, rootId, version) is unchanged.
-- History is not re-keyed on a USER root rename — these markers were never a
-- user root's address, so that rule is not affected.
--
-- `OR IGNORE`: before 2.1.8 a user root could itself be called `briefs`; its
-- rows would collide on the unique index. Such a config no longer loads (the id
-- is reserved), and refusing to open the database over it would strand the
-- project, so the colliding marker rows are left as they are.
UPDATE OR IGNORE file_version SET rootId = 'briefs'  WHERE rootId = 'brief';
UPDATE OR IGNORE file_version SET rootId = 'patches' WHERE rootId = 'patch';
UPDATE OR IGNORE file_version SET rootId = 'plans'   WHERE rootId = 'plan';
