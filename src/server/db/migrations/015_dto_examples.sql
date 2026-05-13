-- M04 DTO: add examples column (named JSON payload exemplars per DTO).
-- Spec: entities/dto.md `dtoexmp1` — soft-validated, name unique within DTO, default [].

ALTER TABLE dto ADD COLUMN examples TEXT NOT NULL DEFAULT '[]';
