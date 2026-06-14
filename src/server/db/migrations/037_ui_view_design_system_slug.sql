-- v0.1.59 — first structural (non-tag) relation: ui-view → design-system.
-- 1:1, deterministic; modelled as a scalar slug column, not a tag, not a junction.
-- No FK constraint (integrity is programmatic / slug-based — decyzja #13).
-- NULL = view has no assigned design system. A non-existent slug does not block
-- writes (dangling → warning).

ALTER TABLE ui_view ADD COLUMN design_system_slug TEXT;
