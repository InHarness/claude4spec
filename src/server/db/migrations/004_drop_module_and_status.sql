-- Etap 3 (iteracja 3): klasyfikacja encji wylacznie przez tagi, status HTTP przez endpoint_dto.
-- Usuwamy kolumny `module` (endpoint, dto) oraz `status_codes` (endpoint).
-- Dodajemy `status_code INTEGER NULL` do endpoint_dto + odbudowujemy UNIQUE index.

DROP INDEX IF EXISTS idx_endpoint_module;
DROP INDEX IF EXISTS idx_dto_module;
DROP INDEX IF EXISTS idx_endpoint_dto_endpoint;
DROP INDEX IF EXISTS idx_endpoint_dto_dto;

ALTER TABLE endpoint DROP COLUMN module;
ALTER TABLE endpoint DROP COLUMN status_codes;
ALTER TABLE dto DROP COLUMN module;

-- SQLite nie wspiera DROP CONSTRAINT; rebuild tabeli endpoint_dto z nowym UNIQUE.
CREATE TABLE endpoint_dto_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint_id INTEGER NOT NULL REFERENCES endpoint(id) ON DELETE CASCADE,
  dto_id INTEGER NOT NULL REFERENCES dto(id) ON DELETE CASCADE,
  relation TEXT NOT NULL,
  status_code INTEGER,
  UNIQUE(endpoint_id, dto_id, relation, status_code)
);

INSERT INTO endpoint_dto_new (id, endpoint_id, dto_id, relation, status_code)
  SELECT id, endpoint_id, dto_id, relation, NULL FROM endpoint_dto;

DROP TABLE endpoint_dto;
ALTER TABLE endpoint_dto_new RENAME TO endpoint_dto;

CREATE INDEX idx_endpoint_dto_endpoint ON endpoint_dto(endpoint_id);
CREATE INDEX idx_endpoint_dto_dto ON endpoint_dto(dto_id);
