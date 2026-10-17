import type { UiKitBinding, UiKitDataSourceUsage, UiKitGroup, UiKitStability } from './identity.js';

/** One element of `props[]` — a prop of the component's contract, in prop order. */
export interface UiKitProp {
  name: string;
  /** The literal TypeScript type. */
  type: string;
  required: boolean;
  default?: string | null;
  description?: string | null;
}

/** One element of `types[]` — a helper type of the contract. A type is defined by exactly one record. */
export interface UiKitType {
  name: string;
  definition: string;
}

/** One element of `dataSources[]` — a host data source, named as the runtime inventory names it. */
export interface UiKitDataSource {
  export: string;
  usage: UiKitDataSourceUsage;
}

/** One element of `composes[]` — a reference to another `ui-kit-component` record. */
export interface UiKitComposes {
  component: string;
}

/**
 * A `ui-kit-component` record as the generated REST and read operations return
 * it (`8kvfhgsj`). `anatomy` is `contentBearing`: a read carries a descriptor in
 * its place, never the value.
 */
export interface UiKitComponent {
  slug: string;
  title: string;
  name: string;
  group: UiKitGroup;
  stability: UiKitStability;
  binding: UiKitBinding;
  props: UiKitProp[];
  types: UiKitType[];
  dataSources: UiKitDataSource[];
  composes: UiKitComposes[];
  soleAnatomyOf?: string | null;
  behavior?: string | null;
  anatomy?: unknown;
  tags: string[];
  createdAt?: string;
  updatedAt?: string;
}
