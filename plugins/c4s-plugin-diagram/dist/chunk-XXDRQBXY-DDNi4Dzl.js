import { _ as __name, j as select } from "./mermaid.core-C1SGswPB.js";
var getDiagramElement = /* @__PURE__ */ __name((id, securityLevel) => {
  let sandboxElement;
  if (securityLevel === "sandbox") {
    sandboxElement = select("#i" + id);
  }
  const root = securityLevel === "sandbox" ? select(sandboxElement.nodes()[0].contentDocument.body) : select("body");
  const svg = root.select(`[id="${id}"]`);
  return svg;
}, "getDiagramElement");
export {
  getDiagramElement as g
};
//# sourceMappingURL=chunk-XXDRQBXY-DDNi4Dzl.js.map
