const DIAGRAM_TYPE = "diagram";
const DIAGRAM_PATH_PREFIX = "/diagrams";
const DIAGRAM_LABEL = "Diagram";
const DIAGRAM_LABEL_PLURAL = "Diagrams";
const DIAGRAM_PAYLOAD_VERSION = 2;
const DIAGRAM_FORMATS = ["mermaid", "d2"];
const DIAGRAM_DEFAULT_FORMAT = "mermaid";
const DIAGRAM_TITLE_MAX_LENGTH = 200;
const DIAGRAM_TOOLS_SERVER = "diagram-tools";
const VALIDATE_DIAGRAM_TOOL = "validate_diagram";
const DIAGRAM_SLUG_MAX_LENGTH = 60;
const DIAGRAM_COMMAND_ID = "diagram-slash";
const DIAGRAM_COMMAND_LABEL = "/diagram";
const DIAGRAM_POPOVER_KIND = "diagram-create";
const diagramData = {
  schema: {
    title: {
      type: "string",
      required: true,
      kind: "non-empty",
      maxLength: DIAGRAM_TITLE_MAX_LENGTH,
      description: 'Diagram name, e.g. "Checkout sequence". The slug is derived from it on create.'
    },
    /**
     * An `enum`, so the host's write path answers 400 for a value outside the
     * list instead of storing it. `d2` is accepted but not drawn.
     */
    format: {
      type: "enum",
      values: [...DIAGRAM_FORMATS],
      required: true,
      default: DIAGRAM_DEFAULT_FORMAT,
      description: "Diagram language: 'mermaid' (default, rendered) or 'd2' (stored, not rendered)."
    },
    /**
     * The DSL body, verbatim. Deliberately NOT `contentBearing` (the host's
     * built-in field was): the card draws the diagram from this field, so a
     * plain record read carries the text and search scans it with the record.
     * Stored data is unchanged, so `payloadVersion` stays 2. A source that does
     * not parse is still stored — nothing here checks the DSL.
     */
    source: {
      type: "string",
      required: true,
      description: "DSL body of the diagram, verbatim. Returned with the record by get_entities."
    },
    createdAt: { type: "string", column: "created_at", systemManaged: true, computedDefault: "now" },
    updatedAt: { type: "string", column: "updated_at", systemManaged: true, computedDefault: "now" }
  }
};
const diagramSlugPattern = [
  { op: "slugify", field: "title" },
  { op: "truncate", n: DIAGRAM_SLUG_MAX_LENGTH }
];
export {
  DIAGRAM_POPOVER_KIND as D,
  VALIDATE_DIAGRAM_TOOL as V,
  DIAGRAM_COMMAND_LABEL as a,
  DIAGRAM_COMMAND_ID as b,
  DIAGRAM_FORMATS as c,
  DIAGRAM_DEFAULT_FORMAT as d,
  DIAGRAM_TOOLS_SERVER as e,
  DIAGRAM_PAYLOAD_VERSION as f,
  diagramSlugPattern as g,
  diagramData as h,
  DIAGRAM_PATH_PREFIX as i,
  DIAGRAM_LABEL_PLURAL as j,
  DIAGRAM_LABEL as k,
  DIAGRAM_TYPE as l
};
//# sourceMappingURL=schema-EL9z7j3u.js.map
