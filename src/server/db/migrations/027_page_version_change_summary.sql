-- M21 Briefs (v0.1.21+) — kolumna `change_summary` na page_version.
-- Brief pkt 11 "For implementers": każda mutacja musi się przelać przez
-- page_version z `changeSummary` (dla PUT pochodzi z body, dla PATCH
-- implemented toggle wystarczy 'set implemented=<bool>').
--
-- Wcześniej DTO `BriefContentUpdateRequest.changeSummary` był przyjmowany
-- przez route, ale gubiony w service layer — brak miejsca w DB do zapisu.

ALTER TABLE page_version
  ADD COLUMN change_summary TEXT NULL;
