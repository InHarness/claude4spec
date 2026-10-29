import { _ as __name } from "./mermaid.core-C1SGswPB.js";
var ImperativeState = class {
  /**
   * @param init - Function that creates the default state.
   */
  constructor(init) {
    this.init = init;
    this.records = this.init();
  }
  static {
    __name(this, "ImperativeState");
  }
  reset() {
    this.records = this.init();
  }
};
export {
  ImperativeState as I
};
//# sourceMappingURL=chunk-2Q5K7J3B-CIg_MGb-.js.map
