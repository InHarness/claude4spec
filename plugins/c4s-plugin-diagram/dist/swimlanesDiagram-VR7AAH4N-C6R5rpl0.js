import { c as createFlowDiagram, s as styles_default } from "./flowDiagram-HODETNUW-CCjrBgVD.js";
import { _ as __name } from "./mermaid.core-C1SGswPB.js";
var getStyles = /* @__PURE__ */ __name((options) => `${styles_default(options)}
  .swimlane.cluster rect {
    stroke: ${options.clusterBorder} !important;
  }
  [data-look="neo"].cluster rect {
    filter: none;
  }
`, "getStyles");
var styles_default2 = getStyles;
var diagram = createFlowDiagram({ defaultLayout: "swimlane", styles: styles_default2 });
export {
  diagram
};
//# sourceMappingURL=swimlanesDiagram-VR7AAH4N-C6R5rpl0.js.map
