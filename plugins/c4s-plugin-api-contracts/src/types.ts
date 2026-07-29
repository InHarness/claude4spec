/**
 * The domain types of the two entity types this package contributes, COPIED
 * VERBATIM from the host's `shared/entities.ts`.
 *
 * They live here because the types belong to whoever owns the entity, and after
 * this change that is this package. The host keeps its own copies only for the
 * generic shapes (`BrokenReference`, `HttpMethod`) that are not specific to
 * `endpoint` or `dto`; those are re-declared below rather than imported,
 * because an extracted package cannot reach into the host for a type.
 */

/**
 * An entity type name. Open on purpose: this package renders chips and links for
 * types it does not own, and the set is defined by whatever is registered.
 */
export type EntityType = string;

/** The HTTP methods an endpoint may declare. Mirrors the host's `HttpMethod`. */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type EndpointDtoRelation = 'request' | 'response' | 'error';

export interface EndpointDtoLink {
  dtoSlug: string;
  dtoName: string;
  relation: EndpointDtoRelation;
  statusCode: number | null;
}

export interface Endpoint {
  slug: string;
  method: HttpMethod;
  path: string;
  summary: string;
  description: string | null;
  tags: string[];
  dtos: EndpointDtoLink[];
  createdAt: string;
  updatedAt: string;
}

export interface EndpointCreateInput {
  method: HttpMethod;
  path: string;
  summary?: string;
  description?: string;
  tags?: string[];
}

export interface EndpointUpdateInput {
  method?: HttpMethod;
  path?: string;
  summary?: string;
  description?: string | null;
  tags?: string[];
  newSlug?: string;
}


export interface EndpointListQuery {
  tags?: string[];
  tagFilter?: 'and' | 'or';
  search?: string;
  limit?: number;
  offset?: number;
}


export interface EndpointDeleteResult {
  deleted: true;
  brokenReferences: BrokenReference[];
}


export interface BrokenReference {
  pagePath: string;
  tagType: string;
  line: number;
  slug?: string;
  type?: string;
}


export interface DtoField {
  name: string;
  type: string;
  required: boolean;
  description?: string;
}

export interface DtoExample {
  name: string;
  summary?: string;
  value: unknown;
}

export interface DtoEndpointLink {
  endpointSlug: string;
  method: HttpMethod;
  path: string;
  relation: EndpointDtoRelation;
  statusCode: number | null;
}

export interface Dto {
  slug: string;
  name: string;
  description: string | null;
  fields: DtoField[];
  examples: DtoExample[];
  tags: string[];
  endpoints: DtoEndpointLink[];
  createdAt: string;
  updatedAt: string;
}

export interface DtoCreateInput {
  name: string;
  description?: string;
  fields?: DtoField[];
  examples?: DtoExample[];
  tags?: string[];
  /** Optional explicit slug — used by M17 restore to preserve identity (decyzja 4). */
  slug?: string;
}

export interface DtoUpdateInput {
  name?: string;
  description?: string | null;
  fields?: DtoField[];
  examples?: DtoExample[];
  tags?: string[];
  newSlug?: string;
}

export interface DtoListQuery {
  tags?: string[];
  tagFilter?: 'and' | 'or';
  search?: string;
  limit?: number;
  offset?: number;
}

export interface DtoDeleteResult {
  deleted: true;
  brokenReferences: BrokenReference[];
}
