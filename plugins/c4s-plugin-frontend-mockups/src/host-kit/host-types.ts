/**
 * Structural types for the cross-cutting host services this package receives
 * through `MountContext`.
 *
 * The published Host API types those slots `any`, deliberately — their real
 * types pull express, better-sqlite3 and the Tiptap registry, none of which is
 * part of the contract. So a plugin declares the SHAPE it actually uses, and
 * gets compile-time checking on exactly the calls it makes.
 *
 * 0.2.28: the envelope grew its first `backend` slots — `design-system` a
 * service, `ui-view` a route — so the reader and host shapes the mockup router
 * calls are declared here too, still narrowed to the handful of methods it
 * actually uses.
 */

/** One row as the generic reader hands it over, before a serializer shapes it. */
export interface RawEntity {
  type: string;
  slug: string;
  data: Record<string, unknown>;
  tags: string[];
}

/** A page section that references an entity. */
export interface SectionEntityRef {
  anchor: string;
  pagePath: string;
  headingText: string;
  relation: string;
}

/**
 * The raw row read the mockup router makes — for the VIEW only.
 *
 * It has to be the raw reader rather than the M39 core here, because
 * `mockupHtml` is `contentBearing` and a record from `getEntities` therefore
 * omits it by design. The projection row is where the value actually is.
 */
export interface MockupReader {
  getEntity(type: string, slug: string): RawEntity | null;
}

/** The one host lookup the mockup router makes. */
export interface MockupHost {
  getEntityService(type: string): unknown;
}

/**
 * The M39 read core, narrowed to the one call the mockup router makes.
 *
 * Reading the OTHER type — the design system — goes through this rather than
 * the raw reader: `groups` and `modes` are declared collections, so they live
 * in child tables and the projection row does not carry them. This is also the
 * sanctioned door for a plugin reading a type that is not its own.
 */
export interface MockupDiscovery {
  getEntities(input: { type: string; slugs: string[] }): {
    results: Array<{ slug: string; entity: unknown | null }>;
  };
}

/** `MountContext`, narrowed to what `uiViewMockupRouter` touches. */
export interface MockupMountContext {
  reader: MockupReader;
  host: MockupHost;
  /** A thunk: mounting runs before the core exists, so resolve it per request. */
  discovery(): MockupDiscovery;
  cwd: string;
}
