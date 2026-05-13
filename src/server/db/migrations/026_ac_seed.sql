-- v0.1.15 — 14 startowych Acceptance Criteria pokrywających M06 / M19 / M20.
-- Każdy AC seedowany pod istniejące moduły: kind='requirement', status='active',
-- plus tag mNN wiążący z modułem.
-- Idempotent — INSERT OR IGNORE na (ac.slug UNIQUE) i (entity_tag UNIQUE).

INSERT OR IGNORE INTO tag (slug, name) VALUES ('m06', 'm06');
INSERT OR IGNORE INTO tag (slug, name) VALUES ('m19', 'm19');
INSERT OR IGNORE INTO tag (slug, name) VALUES ('m20', 'm20');

INSERT OR IGNORE INTO ac (slug, text, kind, status, verifies) VALUES
  ('m06-anchor-length-contract',
   'Anchory generowane przez section indexer mają dokładnie 8 znaków z alfabetu [a-z0-9]; walidacja/parsing akceptuje 6-12 znaków (manualne semantyczne anchory).',
   'requirement', 'active', '[]'),
  ('m06-section-indexer-auto-injection',
   'Section indexer auto-injectuje anchor comments do nagłówków bez anchora; nie modyfikuje nagłówków, które już mają anchor.',
   'requirement', 'active', '[]'),
  ('m06-section-ref-chip-rendering',
   '<section_ref anchor="X"/> renderuje się jako klikalny chip z heading text i page path; broken anchor (brak w section_index) renderuje broken chip.',
   'requirement', 'active', '[]'),

  ('m19-find-references-include-tag-matches',
   'find_references(type, slug, { includeTagMatches: true }) zwraca dynamic refs ze stron z <tagged_list/> i <tagged_list_mixed/>, których atrybut tags przecina się z tagami encji; pole via[] obecne tylko dla dynamic rows.',
   'requirement', 'active', '[]'),
  ('m19-tagged-list-type-mismatch-skipped',
   '<tagged_list type="X"/> z type różnym od typu szukanej encji jest pomijany w find_references({includeTagMatches:true}) — embed nie pokazałby tej encji.',
   'requirement', 'active', '[]'),
  ('m19-untagged-entity-no-op',
   'Encja bez żadnego tagu w find_references({includeTagMatches:true}) → no-op (intersect zawsze pusty, brak dynamic rows w output).',
   'requirement', 'active', '[]'),

  ('m20-three-editor-contexts',
   'EditorFactory wspiera trzy konteksty edytora: page (pełny markdown), description (markdown bez task lists), plan (markdown + XML chips); każdy z osobnym mention sources rejestrem.',
   'requirement', 'active', '[]'),
  ('m20-editor-factory-create',
   'EditorFactory.create(contextId, initial) zwraca tiptap Editor zhydratowany dla danego kontekstu z initial content jako markdown string.',
   'requirement', 'active', '[]'),
  ('m20-markdown-it-xml-rules',
   'markdown-it ma custom rules xml_inline, xml_block, xml_block_content rozpoznające 6 nazw XML reference tags (inline_mention, single_element, element_list, tagged_list, tagged_list_mixed, section_ref).',
   'requirement', 'active', '[]'),
  ('m20-xml-inline-dispatch-six-tags',
   'xml_inline markdown-it rule dispatcher mapuje wszystkie 6 tag names na odpowiednie tiptap node types (5 z M19 + section_ref jako extension reference).',
   'requirement', 'active', '[]'),
  ('m20-gfm-task-lists',
   'Edytor wspiera GFM task lists (- [x] checked / - [ ] unchecked) z renderowaniem checkboxów i toggle przy kliknięciu.',
   'requirement', 'active', '[]'),
  ('m20-five-generic-m19-nodes',
   'Pięć generycznych tiptap nodów M19 (InlineMentionNode, SingleElementNode, ElementListNode, TaggedListNode, TaggedListMixedNode) deleguje render do clientPluginHost.getEntity(type).renderChip / renderCard.',
   'requirement', 'active', '[]'),
  ('m20-outline-gutter',
   'Outline gutter pokazuje listę sekcji strony z anchor + heading text; klik w pozycji scrolluje edytor do anchor i podświetla wiersz.',
   'requirement', 'active', '[]'),
  ('m20-ws-query-keys',
   'WebSocket events broadcastują invalidation keys mapujące na konkretne tanstack-query query keys; useChat / useEntityList nasłuchują i invalidują tylko zmienione zapytania.',
   'requirement', 'active', '[]');

-- Wiązanie AC z tagami modułów. SELECT-based pattern — działa bez względu na
-- to, czy INSERT OR IGNORE wyżej wstawił nowy wiersz czy ominął istniejący.
INSERT OR IGNORE INTO entity_tag (entity_type, entity_id, tag_id)
SELECT 'ac', a.id, t.id FROM ac a, tag t
WHERE (a.slug, t.slug) IN (
  ('m06-anchor-length-contract', 'm06'),
  ('m06-section-indexer-auto-injection', 'm06'),
  ('m06-section-ref-chip-rendering', 'm06'),
  ('m19-find-references-include-tag-matches', 'm19'),
  ('m19-tagged-list-type-mismatch-skipped', 'm19'),
  ('m19-untagged-entity-no-op', 'm19'),
  ('m20-three-editor-contexts', 'm20'),
  ('m20-editor-factory-create', 'm20'),
  ('m20-markdown-it-xml-rules', 'm20'),
  ('m20-xml-inline-dispatch-six-tags', 'm20'),
  ('m20-gfm-task-lists', 'm20'),
  ('m20-five-generic-m19-nodes', 'm20'),
  ('m20-outline-gutter', 'm20'),
  ('m20-ws-query-keys', 'm20')
);
