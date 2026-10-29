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
const DIAGRAM_COMMAND_TRIGGER = "diagram";
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
     * The DSL body, verbatim. `contentBearing`: a plain read returns
     * `hasSource` / `sourceBytes` instead of the text. A source that does not
     * parse is still stored — nothing here checks the DSL.
     */
    source: {
      type: "string",
      required: true,
      contentBearing: true,
      description: "DSL body of the diagram, verbatim. Content-bearing: read it with get_field_content, not through get_entities."
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
  DIAGRAM_COMMAND_TRIGGER as a,
  DIAGRAM_FORMATS as b,
  DIAGRAM_DEFAULT_FORMAT as c,
  DIAGRAM_TOOLS_SERVER as d,
  DIAGRAM_PAYLOAD_VERSION as e,
  diagramSlugPattern as f,
  diagramData as g,
  DIAGRAM_PATH_PREFIX as h,
  DIAGRAM_LABEL_PLURAL as i,
  DIAGRAM_LABEL as j,
  DIAGRAM_TYPE as k
};
//# sourceMappingURL=schema-R4aIrSYQ.js.map
