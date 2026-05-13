-- Etap 3 (iteracja 2): usuwamy freeform request_body/response_body z endpoint.
-- Kontrakt danych zawsze przez endpoint_dto (request/response/error).

ALTER TABLE endpoint DROP COLUMN request_body;
ALTER TABLE endpoint DROP COLUMN response_body;
