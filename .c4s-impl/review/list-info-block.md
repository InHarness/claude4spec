# list-info-block — non-blocking review findings

Client half only. Rule 17 is out of scope by owner decision (dev-0004).

- **rev-0001** `src/client/tiptap/extensions/views/NoListView.tsx:10`: the doc comment says `check_consistency` reports the same tag (rule 17), but the rule does not exist and is being removed from the spec. Drop that sentence.
- **rev-0002** `src/client/xml-markup/tags/references/TaggedList.tsx:48`: when `listByTags` fails, the block shows "0 matching entities". `ElementList.tsx:54` in the same situation shows "…". Both should show an unknown count on error, the same way.
