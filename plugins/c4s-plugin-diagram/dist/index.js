import { D as DIAGRAM_POPOVER_KIND, a as DIAGRAM_COMMAND_TRIGGER, V as VALIDATE_DIAGRAM_TOOL, b as DIAGRAM_FORMATS, c as DIAGRAM_DEFAULT_FORMAT, d as DIAGRAM_TOOLS_SERVER, e as DIAGRAM_PAYLOAD_VERSION, f as diagramSlugPattern, g as diagramData, h as DIAGRAM_PATH_PREFIX, i as DIAGRAM_LABEL_PLURAL, j as DIAGRAM_LABEL, k as DIAGRAM_TYPE } from "./schema-R4aIrSYQ.js";
import { mcpTool, z, createMcpServer } from "@c4s/plugin-runtime";
const diagramCommands = [
  {
    name: `${DIAGRAM_COMMAND_TRIGGER}-slash`,
    trigger: DIAGRAM_COMMAND_TRIGGER,
    label: `/${DIAGRAM_COMMAND_TRIGGER}`,
    description: "Insert a Mermaid diagram",
    hint: "mermaid DSL",
    popoverKind: DIAGRAM_POPOVER_KIND
  }
];
const DOM_GLOBALS = [
  "window",
  "document",
  "DOMParser",
  "Node",
  "Element",
  "HTMLElement",
  "NodeFilter",
  "navigator"
];
const MERMAID_WARNING_PREFIX = "mermaid source may be invalid: ";
let mermaidParse = null;
async function importMermaidWithDom() {
  const globals = globalThis;
  const saved = /* @__PURE__ */ new Map();
  try {
    const { Window } = await import("./index-BhKV-B5s.js");
    const win = new Window({ url: "http://localhost" });
    for (const key of DOM_GLOBALS) {
      const value = key === "window" ? win : win[key];
      try {
        const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
        Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
        saved.set(key, descriptor);
      } catch {
      }
    }
    const mod = await import("./mermaid.core-C1SGswPB.js").then((n) => n.cc);
    const mermaid = mod.default ?? mod;
    return typeof mermaid.parse === "function" ? mermaid.parse.bind(mermaid) : null;
  } catch {
    return null;
  } finally {
    for (const [key, descriptor] of saved) {
      try {
        delete globals[key];
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      } catch {
      }
    }
  }
}
function ensureMermaid() {
  mermaidParse ??= importMermaidWithDom().then(
    (parse) => {
      if (!parse) mermaidParse = null;
      return parse;
    },
    () => {
      mermaidParse = null;
      return null;
    }
  );
  return mermaidParse;
}
async function validateDiagramSource(format, source) {
  if (format !== "mermaid") return [];
  if (!source.trim()) return [];
  const parse = await ensureMermaid().catch(() => null);
  if (!parse) return [];
  try {
    await parse(source);
    return [];
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return [`${MERMAID_WARNING_PREFIX}${message.split("\n")[0]}`];
  }
}
const ok = (payload) => ({
  content: [{ type: "text", text: JSON.stringify(payload) }]
});
function createDiagramToolsServer() {
  const validate = mcpTool(
    VALIDATE_DIAGRAM_TOOL,
    [
      "Check a diagram DSL source before creating or updating a diagram record and return warnings. It never blocks a write: create and update the record with create_entities / update_entities.",
      "Only Mermaid is checked: a d2 source, an empty source, or a server without Mermaid gives no warnings. Warnings carry no line numbers.",
      'Returns: { ok, warnings[] }; ok is true when warnings is empty. A Mermaid syntax error gives one warning "mermaid source may be invalid: <first line of the error>".',
      "Refusals: none; the result always carries the warnings list."
    ].join("\n"),
    {
      source: z.string().describe("The DSL source to check, as text."),
      format: z.enum(DIAGRAM_FORMATS).optional().describe(`Language of the source: mermaid or d2. Default ${DIAGRAM_DEFAULT_FORMAT}.`)
    },
    async (input) => {
      try {
        const { source, format } = input ?? {};
        const warnings = await validateDiagramSource(
          typeof format === "string" ? format : DIAGRAM_DEFAULT_FORMAT,
          typeof source === "string" ? source : ""
        );
        return ok({ ok: warnings.length === 0, warnings });
      } catch {
        return ok({ ok: true, warnings: [] });
      }
    }
  );
  return createMcpServer({ name: DIAGRAM_TOOLS_SERVER, tools: [validate] });
}
const DIAGRAM_REFERENCES_BLOCK_NAME = "diagram_references";
const DIAGRAM_REFERENCES_BLOCK = `<diagram_references>
  <single_element type="diagram" slug="..." caption="..."/>
  <inline_mention type="diagram" slug="..."/>
A \`diagram\` is embedded with the GENERIC reference tags, like every other entity type. The Mermaid DSL \`source\` is the entity's truth (stored in \`.claude4spec/entities/diagram/<slug>.json\`), NOT inline in the page. The page tag carries \`type\`, \`slug\` (which diagram) and an optional \`caption\` — caption is per-reference prose, so the same diagram can show different captions in different places. Tiptap fetches the source by slug and renders it live, with a fallback \`<pre>\` on parse error. Create and edit diagrams through the generic \`entity-tools\` CRUD; \`diagram-tools\` keeps only \`validate_diagram\` (DSL pre-flight). Insertable via slash command \`/diagram\` (authors the source, creates the entity, inserts the reference) in page and plan editors.

\`diagram\` is a HIDDEN type: it has no sidebar tab and no detail page, so \`<element_list type="diagram" .../>\` and \`<tagged_list type="diagram" .../>\` are NOT supported — embed diagrams one at a time.

Example:
  <single_element type="diagram" slug="auth-flow" caption="Auth flow"/>
</diagram_references>`;
const diagramPromptBlocks = [{ name: DIAGRAM_REFERENCES_BLOCK_NAME, body: DIAGRAM_REFERENCES_BLOCK }];
const DIAGRAM_NARRATIVE = "A diagram is lifted out into an entity: its Mermaid DSL lives in the record and never goes into the page body. On a page, a diagram is embedded with the generic reference tags, whose grammar is given by the `diagram_references` block.";
const diagramSystemPrompt = {
  roleNoun: "Diagrams",
  narrativeBlock: DIAGRAM_NARRATIVE,
  mcpToolsLine: `${DIAGRAM_TOOLS_SERVER}: ${VALIDATE_DIAGRAM_TOOL}`,
  promptBlocks: diagramPromptBlocks
};
function diagramPayloadV1ToV2(payload) {
  const p = payload;
  const hasTitle = typeof p.title === "string" && p.title.trim() !== "";
  if (hasTitle && !("caption" in p) && !("firstSourceIdentifier" in p)) return payload;
  const { caption: _caption, firstSourceIdentifier: _first, ...rest } = p;
  if (!hasTitle) rest.title = String(p.slug ?? "");
  return rest;
}
const diagramPayloadUpgrades = [diagramPayloadV1ToV2];
const diagramEntity = {
  type: DIAGRAM_TYPE,
  label: DIAGRAM_LABEL,
  labelPlural: DIAGRAM_LABEL_PLURAL,
  pathPrefix: DIAGRAM_PATH_PREFIX,
  data: diagramData,
  slugPattern: diagramSlugPattern,
  slugCollision: "error",
  payloadVersion: DIAGRAM_PAYLOAD_VERSION,
  payloadUpgrades: diagramPayloadUpgrades,
  systemPrompt: diagramSystemPrompt,
  backend: {
    // `diagram-tools`: `validate_diagram` reads no record, so neither service nor ctx is passed.
    mcpServer: () => createDiagramToolsServer()
  }
};
const manifest = {
  name: "c4s-plugin-diagram",
  version: "0.1.0",
  hostApiVersion: "^2.1.0",
  engines: { node: ">=20" },
  contributes: {
    entities: [diagramEntity],
    commands: diagramCommands
  }
};
export {
  manifest as default,
  manifest
};
//# sourceMappingURL=index.js.map
