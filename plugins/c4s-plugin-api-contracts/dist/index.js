import { E as ENDPOINT_DTO_TABLE, d as dtoSlug, D as DTO_PATH_PREFIX, a as DTO_DISPLAY_ORDER, b as DTO_TABLE, c as DTO_TYPE, e as ENDPOINT_TYPE, f as endpointSlug, g as ENDPOINT_PATH_PREFIX, h as ENDPOINT_DISPLAY_ORDER, i as ENDPOINT_TABLE } from "./identity-BkDoU8yY.js";
import { Router } from "express";
import { z } from "zod";
import { mcpTool, createMcpServer } from "@c4s/plugin-runtime";
function findEndpointDtos(db, endpointSlug2) {
  const rows = db.prepare(
    `SELECT d.slug AS dto_slug, d.name AS dto_name,
              ed.relation AS relation, ed.status_code AS status_code
         FROM ${ENDPOINT_DTO_TABLE} ed
         JOIN dto d ON d.slug = ed.dto_slug
        WHERE ed.endpoint_slug = ?
        ORDER BY ed.relation, ed.status_code, d.name`
  ).all(endpointSlug2);
  return rows.map((r) => ({
    dtoSlug: r.dto_slug,
    dtoName: r.dto_name,
    relation: r.relation,
    statusCode: r.status_code
  }));
}
function findDtoEndpoints(db, dtoSlug2) {
  const rows = db.prepare(
    `SELECT e.slug AS slug, e.method AS method, e.path AS path,
              ed.relation AS relation, ed.status_code AS status_code
         FROM ${ENDPOINT_DTO_TABLE} ed
         JOIN endpoint e ON e.slug = ed.endpoint_slug
        WHERE ed.dto_slug = ?
        ORDER BY ed.relation, ed.status_code, e.path`
  ).all(dtoSlug2);
  return rows.map((r) => ({
    endpointSlug: r.slug,
    method: r.method,
    path: r.path,
    relation: r.relation,
    statusCode: r.status_code
  }));
}
function syncEndpointDtos(service, endpointSlug2, target) {
  if (!service?.getBySlug) {
    return { linked: 0, unlinked: 0, warnings: [`entity service for type 'endpoint' not registered`] };
  }
  const ep = service.getBySlug(endpointSlug2);
  if (!ep) return { linked: 0, unlinked: 0, warnings: [`endpoint '${endpointSlug2}' not found`] };
  const keyOf = (l) => `${l.relation}|${l.dtoSlug}|${l.statusCode ?? "null"}`;
  const currentSet = new Map(ep.dtos.map((l) => [keyOf(l), l]));
  const targetSet = new Map(target.map((l) => [keyOf(l), l]));
  let linked = 0;
  let unlinked = 0;
  const warnings = [];
  for (const [k, current] of currentSet) {
    if (targetSet.has(k)) continue;
    try {
      service.unlinkDto(
        endpointSlug2,
        current.dtoSlug,
        current.relation,
        current.statusCode,
        { writeFile: false }
      );
      unlinked += 1;
    } catch (err) {
      warnings.push(`unlink '${k}' failed: ${err.message}`);
    }
  }
  for (const [k, want] of targetSet) {
    if (currentSet.has(k)) continue;
    try {
      service.linkDto(endpointSlug2, want.dtoSlug, want.relation, want.statusCode, {
        writeFile: false
      });
      linked += 1;
    } catch (err) {
      warnings.push(`link '${k}' failed: ${err.message}`);
    }
  }
  return { linked, unlinked, warnings };
}
function baseSingle$1(entity) {
  return {
    type: "dto",
    slug: entity.slug,
    name: entity.data.name,
    description: entity.data.description ?? null,
    fields: entity.data.fields ?? [],
    examples: entity.data.examples ?? [],
    tags: entity.tags
  };
}
function buildSnapshot$1(entity) {
  return {
    slug: entity.slug,
    name: entity.data.name,
    description: entity.data.description ?? null,
    fields: (entity.data.fields ?? []).map((f) => ({
      name: f.name,
      type: f.type,
      required: f.required,
      ...f.description !== void 0 ? { description: f.description } : {}
    })),
    examples: (entity.data.examples ?? []).map((e) => ({
      name: e.name,
      ...e.summary !== void 0 ? { summary: e.summary } : {},
      value: e.value
    })),
    tags: [...entity.tags].sort()
  };
}
function coerceDto(raw) {
  const r = raw ?? {};
  return {
    slug: String(r.slug ?? ""),
    name: String(r.name ?? ""),
    description: r.description ?? null,
    fields: Array.isArray(r.fields) ? r.fields : [],
    examples: Array.isArray(r.examples) ? r.examples : [],
    tags: Array.isArray(r.tags) ? r.tags : []
  };
}
function dtoDiff(a, b, slug) {
  if (a == null && b == null) return { type: "dto", slug, op: "noop" };
  if (a == null) return { type: "dto", slug, op: "created" };
  if (b == null) return { type: "dto", slug, op: "deleted" };
  const sa = coerceDto(a);
  const sb = coerceDto(b);
  const changes = {};
  const metaChanges = [];
  if (sa.name !== sb.name) metaChanges.push({ field: "name", from: sa.name, to: sb.name });
  if (sa.description !== sb.description) metaChanges.push({ field: "description", from: sa.description, to: sb.description });
  if (metaChanges.length) changes.meta_changes = metaChanges;
  const aFields = new Map(sa.fields.map((f) => [f.name, f]));
  const bFields = new Map(sb.fields.map((f) => [f.name, f]));
  const fieldAdded = [];
  const fieldRemoved = [];
  const fieldModified = [];
  for (const [name, f] of bFields) {
    if (!aFields.has(name)) fieldAdded.push({ name, type: f.type, required: f.required });
  }
  for (const [name, f] of aFields) {
    const other = bFields.get(name);
    if (!other) {
      fieldRemoved.push({ name, type: f.type, required: f.required });
      continue;
    }
    const fc = { name };
    if (f.type !== other.type) fc.type_changed = { from: f.type, to: other.type };
    if (f.required !== other.required) fc.required_changed = { from: f.required, to: other.required };
    if (f.description !== other.description) fc.description_changed = { from: f.description ?? null, to: other.description ?? null };
    if (Object.keys(fc).length > 1) fieldModified.push(fc);
  }
  if (fieldAdded.length) changes.field_added = fieldAdded;
  if (fieldRemoved.length) changes.field_removed = fieldRemoved;
  if (fieldModified.length) changes.field_modified = fieldModified;
  const aEx = new Map(sa.examples.map((e) => [e.name, e]));
  const bEx = new Map(sb.examples.map((e) => [e.name, e]));
  const exAdded = [];
  const exRemoved = [];
  const exModified = [];
  for (const [name] of bEx) if (!aEx.has(name)) exAdded.push({ name });
  for (const [name, e] of aEx) {
    const other = bEx.get(name);
    if (!other) {
      exRemoved.push({ name });
      continue;
    }
    const summaryChanged = (e.summary ?? null) !== (other.summary ?? null);
    const valueChanged = JSON.stringify(e.value) !== JSON.stringify(other.value);
    if (summaryChanged || valueChanged) {
      exModified.push({
        name,
        ...summaryChanged ? { summary_changed: true } : {},
        ...valueChanged ? { value_changed: true } : {}
      });
    }
  }
  if (exAdded.length) changes.example_added = exAdded;
  if (exRemoved.length) changes.example_removed = exRemoved;
  if (exModified.length) changes.example_modified = exModified;
  const tagAdded = sb.tags.filter((t) => !sa.tags.includes(t));
  const tagRemoved = sa.tags.filter((t) => !sb.tags.includes(t));
  if (tagAdded.length) changes.tag_added = tagAdded;
  if (tagRemoved.length) changes.tag_removed = tagRemoved;
  if (Object.keys(changes).length === 0) return { type: "dto", slug, op: "noop" };
  return { type: "dto", slug, op: "modified", changes };
}
function dtoRestore(data, ctx) {
  const snap = data;
  const result = ctx.writer.upsert(
    "dto",
    snap.slug,
    {
      name: snap.name,
      description: snap.description ?? void 0,
      fields: snap.fields,
      examples: snap.examples,
      slug: snap.slug
    },
    ctx.actor
  );
  if (!result) {
    return { op: "noop", entity: null, warnings: [`entity service for type 'dto' is not available — restore skipped`] };
  }
  ctx.writer.syncTags("dto", snap.slug, snap.tags);
  const upserted = result;
  return { op: upserted.op, entity: upserted.entity };
}
const dtoSerializer = {
  type: "dto",
  version: "1.1.0",
  inlineMention: (entity) => ({
    type: "dto",
    slug: entity.slug,
    label: entity.data.name ?? entity.slug,
    href: `/dtos/${entity.slug}`
  }),
  singleElement: (entity) => baseSingle$1(entity),
  elementListItem: (entity) => baseSingle$1(entity),
  taggedListItem: (entity) => baseSingle$1(entity),
  detail: (entity, ctx) => {
    const base = baseSingle$1(entity);
    const endpoints = findDtoEndpoints(ctx.reader.db, entity.slug).map((e) => ({
      endpointSlug: e.endpointSlug,
      method: e.method,
      path: e.path,
      relation: e.relation,
      statusCode: e.statusCode
    }));
    const references = ctx.reader.findSectionReferences("dto", entity.slug).map((r) => ({
      anchor: r.anchor,
      pagePath: r.pagePath,
      headingText: r.headingText,
      relation: r.relation
    }));
    return {
      ...base,
      endpoints,
      _references: references
    };
  },
  // ─── M17 ───
  snapshot: (entity) => buildSnapshot$1(entity),
  restore: dtoRestore,
  diff: dtoDiff
};
const dtoSystemPrompt = {
  roleNoun: "DTOs",
  countStat: {
    placeholder: "dtoCount",
    sqlQuery: "SELECT COUNT(*) AS count FROM dto",
    label: "dtos"
  },
  narrativeBlock: "Data Transfer Objects — named field schemas (name, type, required, description), examples, linked endpoints, tags."
};
class DomainError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "DomainError";
  }
}
const STATUS_FOR_CODE = {
  NOT_FOUND: 404,
  VERSION_NOT_FOUND: 404,
  SLUG_CONFLICT: 409,
  VALIDATION: 400
};
const errorHandler = (err, _req, res, next) => {
  if (res.headersSent) return next(err);
  if (err instanceof DomainError) {
    return res.status(STATUS_FOR_CODE[err.code] ?? 400).json({
      error: { code: err.code, message: err.message }
    });
  }
  console.error(err);
  res.status(500).json({ error: { code: "INTERNAL", message: err.message } });
};
function dtosRouter(dtos, references) {
  const router = Router();
  router.get("/", (req, res, next) => {
    try {
      const q = req.query;
      const tags = typeof q.tags === "string" ? q.tags.split(",").filter(Boolean) : void 0;
      const filter = q.tagFilter === "and" || q.tagFilter === "or" ? q.tagFilter : void 0;
      const query = {
        tags,
        tagFilter: filter,
        search: typeof q.search === "string" ? q.search : void 0,
        limit: q.limit ? Number(q.limit) : void 0,
        offset: q.offset ? Number(q.offset) : void 0
      };
      res.json({ dtos: dtos.listRaw(query) });
    } catch (err) {
      next(err);
    }
  });
  router.post("/", (req, res, next) => {
    try {
      const body = req.body;
      res.status(201).json(dtos.createRaw(body, "user"));
    } catch (err) {
      next(err);
    }
  });
  router.get("/:slug", (req, res, next) => {
    try {
      const dto = dtos.getBySlug(req.params.slug);
      if (!dto) return res.status(404).json({ error: { code: "NOT_FOUND", message: "dto not found" } });
      res.json(dto);
    } catch (err) {
      next(err);
    }
  });
  router.patch("/:slug", async (req, res, next) => {
    try {
      const body = req.body;
      const { dto, previousSlug } = dtos.updateRaw(req.params.slug, body, "user");
      if (dto.slug !== previousSlug) {
        await references.propagateSlugChange("dto", previousSlug, dto.slug);
      }
      res.json(dto);
    } catch (err) {
      next(err);
    }
  });
  router.delete("/:slug", async (req, res, next) => {
    try {
      const broken = await references.findReferences("dto", req.params.slug);
      res.json(dtos.remove(req.params.slug, "user", broken.map((b) => ({
        pagePath: b.pagePath,
        tagType: b.tagType,
        line: b.line,
        slug: req.params.slug,
        type: "dto"
      }))));
    } catch (err) {
      next(err);
    }
  });
  router.use(errorHandler);
  return router;
}
class BaseEntityCrudService {
}
function buildFilter$1(query) {
  const where = [];
  const params = [];
  if (query.search) {
    where.push(`(name LIKE ? OR description LIKE ? OR slug LIKE ?)`);
    const like = `%${query.search}%`;
    params.push(like, like, like);
  }
  const tagSlugs = query.tags?.filter(Boolean) ?? [];
  if (tagSlugs.length) {
    const placeholders = tagSlugs.map(() => "?").join(",");
    if (query.tagFilter === "and") {
      where.push(`
        slug IN (
          SELECT et.entity_slug
            FROM entity_tag et
           WHERE et.entity_type = 'dto' AND et.tag_slug IN (${placeholders})
        GROUP BY et.entity_slug
          HAVING COUNT(DISTINCT et.tag_slug) = ?
        )
      `);
      params.push(...tagSlugs, tagSlugs.length);
    } else {
      where.push(`
        slug IN (
          SELECT et.entity_slug FROM entity_tag et
           WHERE et.entity_type = 'dto' AND et.tag_slug IN (${placeholders})
        )
      `);
      params.push(...tagSlugs);
    }
  }
  return { whereSql: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
}
class DtoService extends BaseEntityCrudService {
  constructor(db, tags, versions, store) {
    super();
    this.db = db;
    this.tags = tags;
    this.versions = versions;
    this.store = store;
  }
  createRaw(input, actor, opts = {}) {
    if (!input.name) throw new DomainError("VALIDATION", "name is required");
    const slug = input.slug?.trim() || dtoSlug(input.name);
    if (!slug) throw new DomainError("VALIDATION", "slug resolves to empty");
    const examples = input.examples ?? [];
    validateExampleNames(examples);
    const tx = this.db.transaction(() => {
      const conflict = this.db.prepare(`SELECT 1 FROM dto WHERE slug = ?`).get(slug);
      if (conflict) throw new DomainError("SLUG_CONFLICT", `dto slug '${slug}' already exists`);
      this.db.prepare(
        `INSERT INTO dto (slug, name, description, fields, examples)
           VALUES (?, ?, ?, ?, ?)`
      ).run(
        slug,
        input.name,
        input.description ?? null,
        JSON.stringify(input.fields ?? []),
        JSON.stringify(examples)
      );
      if (input.tags?.length) this.tags.assignTags("dto", slug, input.tags);
      const created2 = this.getBySlugInternal(slug);
      if (opts.capture !== false) {
        this.versions.captureEntitySnapshot("dto", slug, "create", actor, "Created", "1.1.0");
      }
      return created2;
    });
    const created = tx();
    if (opts.writeFile !== false) this.store.persist("dto", created.slug);
    return created;
  }
  listRaw(query = {}) {
    const { whereSql, params } = buildFilter$1(query);
    const limit = Math.min(Math.max(query.limit ?? 200, 1), 500);
    const offset = Math.max(query.offset ?? 0, 0);
    const rows = this.db.prepare(
      `SELECT * FROM dto ${whereSql}
         ORDER BY name
         LIMIT ? OFFSET ?`
    ).all(...params, limit, offset);
    return rows.map((r) => this.hydrate(r));
  }
  count(query = {}) {
    const { whereSql, params } = buildFilter$1(query);
    const row = this.db.prepare(`SELECT COUNT(*) AS c FROM dto ${whereSql}`).get(...params);
    return row.c;
  }
  getBySlug(slug) {
    const row = this.db.prepare(`SELECT * FROM dto WHERE slug = ?`).get(slug);
    return row ? this.hydrate(row) : null;
  }
  updateRaw(slug, input, actor, opts = {}) {
    const tx = this.db.transaction(() => {
      const current = this.db.prepare(`SELECT * FROM dto WHERE slug = ?`).get(slug);
      if (!current) throw new DomainError("NOT_FOUND", `dto '${slug}' not found`);
      const nextName = input.name ?? current.name;
      const nextSlug = input.newSlug?.trim() || current.slug;
      if (nextSlug !== slug) {
        const conflict = this.db.prepare(`SELECT 1 FROM dto WHERE slug = ?`).get(nextSlug);
        if (conflict) throw new DomainError("SLUG_CONFLICT", `dto slug '${nextSlug}' already exists`);
      }
      const nextFields = input.fields !== void 0 ? JSON.stringify(input.fields) : current.fields;
      let nextExamples = current.examples;
      if (input.examples !== void 0) {
        validateExampleNames(input.examples);
        nextExamples = JSON.stringify(input.examples);
      }
      this.db.prepare(
        `UPDATE dto
             SET slug = ?, name = ?, description = ?, fields = ?, examples = ?,
                 updated_at = datetime('now')
           WHERE slug = ?`
      ).run(
        nextSlug,
        nextName,
        input.description !== void 0 ? input.description : current.description,
        nextFields,
        nextExamples,
        slug
      );
      if (nextSlug !== slug) {
        this.db.prepare(`UPDATE entity_tag SET entity_slug = ? WHERE entity_type = 'dto' AND entity_slug = ?`).run(nextSlug, slug);
      }
      if (input.tags) this.tags.assignTags("dto", nextSlug, input.tags);
      const updated = this.getBySlugInternal(nextSlug);
      const summary = nextSlug !== slug ? `Renamed from '${slug}' to '${nextSlug}'` : "Updated";
      if (opts.capture !== false) {
        this.versions.captureEntitySnapshot("dto", nextSlug, "update", actor, summary, "1.1.0");
      }
      return { dto: updated, previousSlug: slug };
    });
    const result = tx();
    if (opts.writeFile !== false) {
      const nextSlug = result.dto.slug;
      if (nextSlug !== slug) this.store.remove("dto", slug);
      this.store.persist("dto", nextSlug);
    }
    return result;
  }
  /**
   * Idempotent UPSERT for M17 restore. CREATE if slug missing, UPDATE
   * otherwise; preserves slug.
   */
  upsert(slug, input, actor, opts = {}) {
    const existing = this.getBySlug(slug);
    if (!existing) {
      const dto2 = this.createRaw({ ...input, slug }, actor, opts);
      return { dto: dto2, entity: dto2, op: "created" };
    }
    const { dto } = this.updateRaw(slug, {
      name: input.name,
      description: input.description,
      fields: input.fields,
      examples: input.examples,
      tags: input.tags
    }, actor, opts);
    return { dto, entity: dto, op: "updated" };
  }
  remove(slug, actor, brokenReferences = [], opts = {}) {
    const tx = this.db.transaction(() => {
      const row = this.db.prepare(`SELECT * FROM dto WHERE slug = ?`).get(slug);
      if (!row) throw new DomainError("NOT_FOUND", `dto '${slug}' not found`);
      if (opts.capture !== false) {
        this.versions.captureEntitySnapshot("dto", slug, "delete", actor, "Deleted", "1.1.0");
      }
      this.db.prepare(`DELETE FROM entity_tag WHERE entity_type = 'dto' AND entity_slug = ?`).run(slug);
      this.db.prepare(`DELETE FROM dto WHERE slug = ?`).run(slug);
      return { deleted: true, brokenReferences };
    });
    const result = tx();
    if (opts.writeFile !== false) this.store.remove("dto", slug);
    return result;
  }
  getBySlugInternal(slug) {
    const row = this.db.prepare(`SELECT * FROM dto WHERE slug = ?`).get(slug);
    if (!row) throw new Error(`dto '${slug}' disappeared mid-tx`);
    return this.hydrate(row);
  }
  hydrate(row) {
    return {
      slug: row.slug,
      name: row.name,
      description: row.description,
      fields: parseFields(row.fields),
      examples: parseExamples(row.examples),
      tags: this.tags.getEntityTagSlugs("dto", row.slug),
      endpoints: this.getLinkedEndpoints(row.slug),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
  getLinkedEndpoints(dtoSlug2) {
    const rows = this.db.prepare(
      `SELECT e.slug AS slug, e.method AS method, e.path AS path,
                ed.relation AS relation, ed.status_code AS status_code
           FROM endpoint_dto ed
           JOIN endpoint e ON e.slug = ed.endpoint_slug
          WHERE ed.dto_slug = ?
          ORDER BY ed.relation, ed.status_code, e.path`
    ).all(dtoSlug2);
    return rows.map((r) => ({
      endpointSlug: r.slug,
      method: r.method,
      path: r.path,
      relation: r.relation,
      statusCode: r.status_code
    }));
  }
  // ─── EntityCrudService (M13 — generic entity-tools) ─────────────────────
  // Thin adapters over the rich methods above, always actor='agent' (the only
  // caller is entity-tools). Distinct names from createRaw/updateRaw/listRaw —
  // TS structurally allows an interface's `unknown`-typed params to widen to
  // a narrower concrete type, but two methods can't share one name with
  // different signatures, and the old rich signatures (actor/opts) must stay
  // intact for routes.ts and M17 restore.
  create(data) {
    const created = this.createRaw(data, "agent");
    return { slug: created.slug };
  }
  get(slug) {
    return this.getBySlug(slug);
  }
  /** `data.newSlug`, when present, renames — see EntityCrudService.update doc. */
  update(slug, data) {
    const { dto } = this.updateRaw(slug, data, "agent");
    return { slug: dto.slug };
  }
  delete(slug) {
    this.remove(slug, "agent");
  }
  list(opts) {
    const items = this.listRaw({ tags: opts.tags, tagFilter: opts.tagFilter, limit: opts.limit, offset: opts.offset });
    const total = this.count({ tags: opts.tags, tagFilter: opts.tagFilter });
    return { items, total };
  }
}
function parseFields(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((f) => f && typeof f === "object" && typeof f.name === "string").map((f) => ({
      name: String(f.name),
      type: typeof f.type === "string" ? f.type : "any",
      required: Boolean(f.required),
      description: typeof f.description === "string" ? f.description : void 0
    }));
  } catch {
    return [];
  }
}
function parseExamples(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((e) => e && typeof e === "object" && typeof e.name === "string").map((e) => ({
      name: String(e.name),
      summary: typeof e.summary === "string" ? e.summary : void 0,
      value: e.value
    }));
  } catch {
    return [];
  }
}
function validateExampleNames(examples) {
  const seen = /* @__PURE__ */ new Set();
  for (const ex of examples) {
    if (!ex || typeof ex.name !== "string" || ex.name.length === 0) {
      throw new DomainError("VALIDATION", "example.name is required");
    }
    if (seen.has(ex.name)) {
      throw new DomainError("EXAMPLE_NAME_CONFLICT", `example name '${ex.name}' is duplicated within DTO`);
    }
    seen.add(ex.name);
  }
}
const fieldSchema = z.object({
  name: z.string(),
  type: z.string(),
  required: z.boolean(),
  description: z.string().optional()
});
const exampleSchema = z.object({
  name: z.string().describe('Identifier unique within DTO (e.g. "minimal", "full", "edge-case")'),
  summary: z.string().optional(),
  value: z.unknown().describe("Payload as-is. Soft-validated against fields[] (warning only).")
});
const dtoCreateSchema = {
  name: z.string().describe("DTO name (PascalCase, e.g. UserResponse)"),
  description: z.string().optional(),
  fields: z.array(fieldSchema).optional(),
  examples: z.array(exampleSchema).optional().describe("Named payload exemplars. Soft-validated. name unique within DTO."),
  tags: z.array(z.string()).optional()
};
const dtoUpdateSchema = {
  name: z.string().optional(),
  description: z.string().nullable().optional(),
  fields: z.array(fieldSchema).optional(),
  examples: z.array(exampleSchema).optional().describe("Full replace of examples array (not diff). Omit to leave unchanged."),
  tags: z.array(z.string()).optional()
};
const dtoMigrations = [
  {
    version: 1,
    name: "create_dto",
    up: `
      CREATE TABLE IF NOT EXISTS dto (
        slug TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        fields TEXT NOT NULL DEFAULT '[]',
        examples TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `
  }
];
const dtoEntity = {
  type: DTO_TYPE,
  table: DTO_TABLE,
  label: "DTO",
  labelPlural: "DTOs",
  displayOrder: DTO_DISPLAY_ORDER,
  pathPrefix: DTO_PATH_PREFIX,
  slugFrom: (data) => dtoSlug(data.name),
  serializer: dtoSerializer,
  systemPrompt: dtoSystemPrompt,
  backend: {
    migrations: dtoMigrations,
    service: (ctx) => new DtoService(ctx.db, ctx.tagsService, ctx.versionService, ctx.entityStore),
    crud: { createSchema: dtoCreateSchema, updateSchema: dtoUpdateSchema },
    routes: { router: (service, ctx) => dtosRouter(service, ctx.referencesService) }
  }
};
function label(entity) {
  const method = entity.data.method ?? "";
  const path = entity.data.path ?? "";
  return `${method} ${path}`.trim();
}
function href(entity) {
  return `/endpoints/${entity.slug}`;
}
function baseSingle(entity, ctx, includeDtos = true) {
  const dtos = includeDtos ? findEndpointDtos(ctx.reader.db, entity.slug) : void 0;
  return {
    type: "endpoint",
    slug: entity.slug,
    method: entity.data.method,
    path: entity.data.path,
    summary: entity.data.summary ?? "",
    description: entity.data.description ?? null,
    tags: entity.tags,
    ...dtos !== void 0 ? { dtos: formatDtos(dtos) } : {}
  };
}
function formatDtos(dtos) {
  return dtos.map((d) => ({
    dtoSlug: d.dtoSlug,
    dtoName: d.dtoName,
    relation: d.relation,
    statusCode: d.statusCode
  }));
}
function buildSnapshot(entity, ctx) {
  const dtos = findEndpointDtos(ctx.reader.db, entity.slug);
  return {
    slug: entity.slug,
    method: entity.data.method,
    path: entity.data.path,
    summary: (entity.data.summary ?? "") || null,
    description: entity.data.description ?? null,
    linked_dtos: dtos.map((d) => ({
      dto_slug: d.dtoSlug,
      relation: d.relation,
      status_code: d.statusCode
    })).sort((a, b) => `${a.relation}:${a.dto_slug}:${a.status_code ?? ""}`.localeCompare(
      `${b.relation}:${b.dto_slug}:${b.status_code ?? ""}`
    )),
    tags: [...entity.tags].sort()
  };
}
function coerceEndpoint(raw) {
  const r = raw ?? {};
  let linked_dtos = r.linked_dtos;
  if (!linked_dtos && Array.isArray(r.dtos)) {
    linked_dtos = r.dtos.map((d) => ({
      dto_slug: String(d.dtoSlug ?? d.dto_slug ?? ""),
      relation: String(d.relation ?? ""),
      status_code: d.statusCode ?? d.status_code ?? null
    }));
  }
  return {
    slug: String(r.slug ?? ""),
    method: String(r.method ?? ""),
    path: String(r.path ?? ""),
    summary: r.summary ?? null,
    description: r.description ?? null,
    linked_dtos: linked_dtos ?? [],
    tags: Array.isArray(r.tags) ? r.tags : []
  };
}
function endpointDiff(a, b, slug) {
  if (a == null && b == null) return { type: "endpoint", slug, op: "noop" };
  if (a == null) return { type: "endpoint", slug, op: "created" };
  if (b == null) return { type: "endpoint", slug, op: "deleted" };
  const sa = coerceEndpoint(a);
  const sb = coerceEndpoint(b);
  const changes = {};
  const fieldChanges = [];
  for (const field of ["method", "path", "summary", "description"]) {
    if (sa[field] !== sb[field]) fieldChanges.push({ field, from: sa[field], to: sb[field] });
  }
  if (fieldChanges.length) changes.field_changes = fieldChanges;
  const keyOf = (l) => `${l.relation}|${l.dto_slug}`;
  const aMap = new Map(sa.linked_dtos.map((l) => [keyOf(l), l]));
  const bMap = new Map(sb.linked_dtos.map((l) => [keyOf(l), l]));
  const dtoAdded = [];
  const dtoRemoved = [];
  const statusChanged = [];
  for (const [k, link] of bMap) {
    if (!aMap.has(k)) dtoAdded.push(link);
  }
  for (const [k, link] of aMap) {
    const other = bMap.get(k);
    if (!other) {
      dtoRemoved.push(link);
    } else if (other.status_code !== link.status_code) {
      statusChanged.push({
        dto_slug: link.dto_slug,
        relation: link.relation,
        from: link.status_code,
        to: other.status_code
      });
    }
  }
  if (dtoAdded.length) changes.dto_added = dtoAdded;
  if (dtoRemoved.length) changes.dto_removed = dtoRemoved;
  if (statusChanged.length) changes.status_code_changed = statusChanged;
  const tagAdded = sb.tags.filter((t) => !sa.tags.includes(t));
  const tagRemoved = sa.tags.filter((t) => !sb.tags.includes(t));
  if (tagAdded.length) changes.tag_added = tagAdded;
  if (tagRemoved.length) changes.tag_removed = tagRemoved;
  if (Object.keys(changes).length === 0) return { type: "endpoint", slug, op: "noop" };
  return { type: "endpoint", slug, op: "modified", changes };
}
function endpointRestore(data, ctx) {
  const snap = data;
  const upsertResult = ctx.writer.upsert(
    "endpoint",
    snap.slug,
    {
      method: snap.method,
      path: snap.path,
      summary: snap.summary ?? "",
      description: snap.description ?? void 0
    },
    ctx.actor
  );
  if (!upsertResult) {
    return { op: "noop", entity: null, warnings: [`entity service for type 'endpoint' is not available — restore skipped`] };
  }
  ctx.writer.syncTags("endpoint", snap.slug, snap.tags);
  const junctionResult = syncEndpointDtos(
    ctx.reader.host?.getEntityService?.(ENDPOINT_TYPE) ?? null,
    snap.slug,
    snap.linked_dtos.map((l) => ({
      dtoSlug: l.dto_slug,
      relation: l.relation,
      statusCode: l.status_code
    }))
  );
  const warnings = junctionResult.warnings.length ? junctionResult.warnings : void 0;
  const upserted = upsertResult;
  return {
    op: upserted.op,
    entity: upserted.entity,
    ...warnings ? { warnings } : {}
  };
}
const endpointSerializer = {
  type: "endpoint",
  version: "1.0.0",
  inlineMention: (entity) => ({
    type: "endpoint",
    slug: entity.slug,
    label: label(entity),
    href: href(entity)
  }),
  singleElement: (entity, ctx) => baseSingle(entity, ctx, true),
  elementListItem: (entity, ctx) => {
    const base = baseSingle(entity, ctx, true);
    const description = base.description ? base.description.split("\n")[0] : null;
    return { ...base, description };
  },
  taggedListItem: (entity, ctx) => {
    const base = baseSingle(entity, ctx, true);
    const description = base.description ? base.description.split("\n")[0] : null;
    return { ...base, description };
  },
  detail: (entity, ctx) => {
    const base = baseSingle(entity, ctx, true);
    const brokenRefs = [];
    const dtos = findEndpointDtos(ctx.reader.db, entity.slug);
    const dtoObjects = dtos.map((link) => {
      const dto = ctx.reader.getEntity("dto", link.dtoSlug);
      if (!dto) {
        brokenRefs.push(`dto:${link.dtoSlug}`);
        return { ...link, dto: null };
      }
      if (ctx.depth >= ctx.maxDepth) {
        return { ...link, dto: { slug: dto.slug, name: dto.data.name, _truncated: true } };
      }
      return {
        ...link,
        dto: {
          slug: dto.slug,
          name: dto.data.name,
          description: dto.data.description ?? null,
          fields: dto.data.fields,
          tags: dto.tags
        }
      };
    });
    const references = ctx.reader.findSectionReferences("endpoint", entity.slug);
    return {
      ...base,
      dtos: dtoObjects,
      _references: formatReferences(references),
      ...brokenRefs.length ? { _brokenRefs: brokenRefs } : {}
    };
  },
  // ─── M17 ───
  snapshot: (entity, ctx) => buildSnapshot(entity, ctx),
  restore: endpointRestore,
  diff: endpointDiff
};
function formatReferences(refs) {
  return refs.map((r) => ({
    anchor: r.anchor,
    pagePath: r.pagePath,
    headingText: r.headingText,
    relation: r.relation
  }));
}
const endpointSystemPrompt = {
  roleNoun: "Endpoints",
  countStat: {
    placeholder: "endpointCount",
    sqlQuery: "SELECT COUNT(*) AS count FROM endpoint",
    label: "endpoints"
  },
  // M13: CRUD moved to the generic entity-tools server (composed by the host);
  // this line now covers ONLY endpoint's custom relation tools.
  mcpToolsLine: "endpoint-tools: link_dto, unlink_dto",
  narrativeBlock: "REST endpoints — method, path, summary, linked request/response/error DTOs, tags."
};
function endpointsRouter(endpoints, references) {
  const router = Router();
  router.get("/", (req, res, next) => {
    try {
      const q = req.query;
      const tags = typeof q.tags === "string" ? q.tags.split(",").filter(Boolean) : void 0;
      const filter = q.tagFilter === "and" || q.tagFilter === "or" ? q.tagFilter : void 0;
      const query = {
        tags,
        tagFilter: filter,
        search: typeof q.search === "string" ? q.search : void 0,
        limit: q.limit ? Number(q.limit) : void 0,
        offset: q.offset ? Number(q.offset) : void 0
      };
      res.json({ endpoints: endpoints.listRaw(query) });
    } catch (err) {
      next(err);
    }
  });
  router.post("/", (req, res, next) => {
    try {
      const body = req.body;
      res.status(201).json(endpoints.createRaw(body, "user"));
    } catch (err) {
      next(err);
    }
  });
  router.get("/:slug", (req, res, next) => {
    try {
      const ep = endpoints.getBySlug(req.params.slug);
      if (!ep) return res.status(404).json({ error: { code: "NOT_FOUND", message: "endpoint not found" } });
      res.json(ep);
    } catch (err) {
      next(err);
    }
  });
  router.patch("/:slug", async (req, res, next) => {
    try {
      const body = req.body;
      const previousSlug = req.params.slug;
      const updated = endpoints.updateRaw(previousSlug, body, "user");
      if (updated.slug !== previousSlug) {
        await references.propagateSlugChange("endpoint", previousSlug, updated.slug);
      }
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });
  router.post("/:slug/dtos", (req, res, next) => {
    try {
      const body = req.body;
      if (!body.dtoSlug || !body.relation) {
        return res.status(400).json({ error: { code: "VALIDATION", message: "dtoSlug and relation required" } });
      }
      const statusCode = typeof body.statusCode === "number" && Number.isInteger(body.statusCode) ? body.statusCode : null;
      const updated = endpoints.linkDto(
        req.params.slug,
        body.dtoSlug,
        body.relation,
        statusCode
      );
      res.status(201).json(updated);
    } catch (err) {
      next(err);
    }
  });
  router.delete("/:slug/dtos/:dtoSlug/:relation", (req, res, next) => {
    try {
      const q = req.query.statusCode;
      const statusCode = typeof q === "string" && q !== "" && Number.isInteger(Number(q)) ? Number(q) : null;
      const updated = endpoints.unlinkDto(
        req.params.slug,
        req.params.dtoSlug,
        req.params.relation,
        statusCode
      );
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });
  router.delete("/:slug", async (req, res, next) => {
    try {
      const slug = req.params.slug;
      const broken = await references.findReferences("endpoint", slug);
      const result = endpoints.remove(slug, "user");
      result.brokenReferences = broken.map((b) => ({
        pagePath: b.pagePath,
        tagType: b.tagType,
        line: b.line,
        slug,
        type: "endpoint"
      }));
      res.json(result);
    } catch (err) {
      next(err);
    }
  });
  router.use(errorHandler);
  return router;
}
const ALLOWED_RELATIONS = /* @__PURE__ */ new Set([
  "request",
  "response",
  "error"
]);
const ALLOWED_METHODS = /* @__PURE__ */ new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE"
]);
function buildFilter(query) {
  const where = [];
  const params = [];
  if (query.search) {
    where.push(`(path LIKE ? OR summary LIKE ? OR slug LIKE ?)`);
    const like = `%${query.search}%`;
    params.push(like, like, like);
  }
  const tagSlugs = query.tags?.filter(Boolean) ?? [];
  if (tagSlugs.length) {
    const placeholders = tagSlugs.map(() => "?").join(",");
    if (query.tagFilter === "and") {
      where.push(`
        slug IN (
          SELECT et.entity_slug
            FROM entity_tag et
           WHERE et.entity_type = 'endpoint' AND et.tag_slug IN (${placeholders})
        GROUP BY et.entity_slug
          HAVING COUNT(DISTINCT et.tag_slug) = ?
        )
      `);
      params.push(...tagSlugs, tagSlugs.length);
    } else {
      where.push(`
        slug IN (
          SELECT et.entity_slug FROM entity_tag et
           WHERE et.entity_type = 'endpoint' AND et.tag_slug IN (${placeholders})
        )
      `);
      params.push(...tagSlugs);
    }
  }
  return { whereSql: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
}
class EndpointService extends BaseEntityCrudService {
  constructor(db, tags, versions, store) {
    super();
    this.db = db;
    this.tags = tags;
    this.versions = versions;
    this.store = store;
  }
  createRaw(input, actor, opts = {}) {
    const method = this.requireMethod(input.method);
    if (!input.path) throw new DomainError("VALIDATION", "path is required");
    const slug = endpointSlug(method, input.path);
    if (!slug) throw new DomainError("VALIDATION", "slug resolves to empty");
    const tx = this.db.transaction(() => {
      const conflict = this.db.prepare(`SELECT 1 FROM endpoint WHERE slug = ?`).get(slug);
      if (conflict) throw new DomainError("SLUG_CONFLICT", `endpoint slug '${slug}' already exists`);
      this.db.prepare(
        `INSERT INTO endpoint (slug, method, path, summary, description)
           VALUES (?, ?, ?, ?, ?)`
      ).run(
        slug,
        method,
        input.path,
        input.summary ?? "",
        input.description ?? null
      );
      if (input.tags?.length) this.tags.assignTags("endpoint", slug, input.tags);
      const created2 = this.getBySlugInternal(slug);
      if (opts.capture !== false) {
        this.versions.captureEntitySnapshot("endpoint", slug, "create", actor, "Created", "1.0.0");
      }
      return created2;
    });
    const created = tx();
    if (opts.writeFile !== false) this.store.persist("endpoint", created.slug);
    return created;
  }
  listRaw(query = {}) {
    const { whereSql, params } = buildFilter(query);
    const limit = Math.min(Math.max(query.limit ?? 200, 1), 500);
    const offset = Math.max(query.offset ?? 0, 0);
    const rows = this.db.prepare(
      `SELECT * FROM endpoint
         ${whereSql}
         ORDER BY path, method
         LIMIT ? OFFSET ?`
    ).all(...params, limit, offset);
    return rows.map((r) => this.hydrate(r));
  }
  count(query = {}) {
    const { whereSql, params } = buildFilter(query);
    const row = this.db.prepare(`SELECT COUNT(*) AS c FROM endpoint ${whereSql}`).get(...params);
    return row.c;
  }
  getBySlug(slug) {
    const row = this.db.prepare(`SELECT * FROM endpoint WHERE slug = ?`).get(slug);
    return row ? this.hydrate(row) : null;
  }
  updateRaw(slug, input, actor, opts = {}) {
    const tx = this.db.transaction(() => {
      const current = this.db.prepare(`SELECT * FROM endpoint WHERE slug = ?`).get(slug);
      if (!current) throw new DomainError("NOT_FOUND", `endpoint '${slug}' not found`);
      const method = input.method ? this.requireMethod(input.method) : current.method;
      const path = input.path ?? current.path;
      const nextSlug = input.newSlug?.trim() || current.slug;
      if (nextSlug !== slug) {
        const conflict = this.db.prepare(`SELECT 1 FROM endpoint WHERE slug = ?`).get(nextSlug);
        if (conflict) throw new DomainError("SLUG_CONFLICT", `endpoint slug '${nextSlug}' already exists`);
      }
      const nextRow = {
        ...current,
        slug: nextSlug,
        method,
        path,
        summary: input.summary ?? current.summary,
        description: input.description !== void 0 ? input.description : current.description
      };
      this.db.prepare(
        `UPDATE endpoint
             SET slug = ?, method = ?, path = ?, summary = ?, description = ?,
                 updated_at = datetime('now')
           WHERE slug = ?`
      ).run(
        nextRow.slug,
        nextRow.method,
        nextRow.path,
        nextRow.summary,
        nextRow.description,
        slug
      );
      if (nextSlug !== slug) {
        this.db.prepare(`UPDATE entity_tag SET entity_slug = ? WHERE entity_type = 'endpoint' AND entity_slug = ?`).run(nextSlug, slug);
      }
      if (input.tags) this.tags.assignTags("endpoint", nextSlug, input.tags);
      const updated = this.getBySlugInternal(nextSlug);
      const summary = nextSlug !== slug ? `Renamed from '${slug}' to '${nextSlug}'` : "Updated";
      if (opts.capture !== false) {
        this.versions.captureEntitySnapshot("endpoint", nextSlug, "update", actor, summary, "1.0.0");
      }
      return updated;
    });
    const result = tx();
    if (opts.writeFile !== false) {
      if (result.slug !== slug) this.store.remove("endpoint", slug);
      this.store.persist("endpoint", result.slug);
    }
    return result;
  }
  /**
   * Idempotent UPSERT used by M17 restore. Routes to create or update based on
   * existence of `slug`; preserves slug across update (no rename).
   */
  upsert(slug, input, actor, opts = {}) {
    const existing = this.getBySlug(slug);
    if (!existing) {
      const entity2 = this.createRaw(input, actor, opts);
      return { entity: entity2, op: "created" };
    }
    const entity = this.updateRaw(slug, {
      method: input.method,
      path: input.path,
      summary: input.summary,
      description: input.description,
      tags: input.tags
    }, actor, opts);
    return { entity, op: "updated" };
  }
  remove(slug, actor, opts = {}) {
    const tx = this.db.transaction(() => {
      const row = this.db.prepare(`SELECT * FROM endpoint WHERE slug = ?`).get(slug);
      if (!row) throw new DomainError("NOT_FOUND", `endpoint '${slug}' not found`);
      if (opts.capture !== false) {
        this.versions.captureEntitySnapshot("endpoint", slug, "delete", actor, "Deleted", "1.0.0");
      }
      this.db.prepare(`DELETE FROM entity_tag WHERE entity_type = 'endpoint' AND entity_slug = ?`).run(slug);
      this.db.prepare(`DELETE FROM endpoint WHERE slug = ?`).run(slug);
      const brokenReferences = [];
      return { deleted: true, brokenReferences };
    });
    const result = tx();
    if (opts.writeFile !== false) this.store.remove("endpoint", slug);
    return result;
  }
  getBySlugInternal(slug) {
    const row = this.db.prepare(`SELECT * FROM endpoint WHERE slug = ?`).get(slug);
    if (!row) throw new Error(`endpoint '${slug}' disappeared mid-tx`);
    return this.hydrate(row);
  }
  hydrate(row) {
    return {
      slug: row.slug,
      method: row.method,
      path: row.path,
      summary: row.summary,
      description: row.description,
      tags: this.tags.getEntityTagSlugs("endpoint", row.slug),
      dtos: this.getLinkedDtos(row.slug),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
  getLinkedDtos(endpointSlug2) {
    const rows = this.db.prepare(
      `SELECT d.slug AS dto_slug, d.name AS dto_name, ed.relation AS relation, ed.status_code AS status_code
           FROM endpoint_dto ed
           JOIN dto d ON d.slug = ed.dto_slug
          WHERE ed.endpoint_slug = ?
          ORDER BY ed.relation, ed.status_code, d.name`
    ).all(endpointSlug2);
    return rows.map((r) => ({
      dtoSlug: r.dto_slug,
      dtoName: r.dto_name,
      relation: r.relation,
      statusCode: r.status_code
    }));
  }
  linkDto(endpointSlug2, dtoSlug2, relation, statusCode = null, opts = {}) {
    if (!ALLOWED_RELATIONS.has(relation)) {
      throw new DomainError("VALIDATION", `invalid relation '${relation}'`);
    }
    if (relation === "request" && statusCode !== null) {
      throw new DomainError("VALIDATION", `request relation must not carry a status code`);
    }
    const ep = this.db.prepare(`SELECT slug FROM endpoint WHERE slug = ?`).get(endpointSlug2);
    if (!ep) throw new DomainError("NOT_FOUND", `endpoint '${endpointSlug2}' not found`);
    const dto = this.db.prepare(`SELECT slug FROM dto WHERE slug = ?`).get(dtoSlug2);
    if (!dto) throw new DomainError("NOT_FOUND", `dto '${dtoSlug2}' not found`);
    this.db.prepare(
      `INSERT OR IGNORE INTO endpoint_dto (endpoint_slug, dto_slug, relation, status_code)
           VALUES (?, ?, ?, ?)`
    ).run(endpointSlug2, dtoSlug2, relation, statusCode);
    const result = this.getBySlugInternal(endpointSlug2);
    if (opts.writeFile !== false) this.store.persist("endpoint", endpointSlug2);
    return result;
  }
  unlinkDto(endpointSlug2, dtoSlug2, relation, statusCode = null, opts = {}) {
    const ep = this.db.prepare(`SELECT slug FROM endpoint WHERE slug = ?`).get(endpointSlug2);
    if (!ep) throw new DomainError("NOT_FOUND", `endpoint '${endpointSlug2}' not found`);
    if (statusCode === null) {
      this.db.prepare(
        `DELETE FROM endpoint_dto
             WHERE endpoint_slug = ? AND dto_slug = ? AND relation = ? AND status_code IS NULL`
      ).run(endpointSlug2, dtoSlug2, relation);
    } else {
      this.db.prepare(
        `DELETE FROM endpoint_dto
             WHERE endpoint_slug = ? AND dto_slug = ? AND relation = ? AND status_code = ?`
      ).run(endpointSlug2, dtoSlug2, relation, statusCode);
    }
    const result = this.getBySlugInternal(endpointSlug2);
    if (opts.writeFile !== false) this.store.persist("endpoint", endpointSlug2);
    return result;
  }
  requireMethod(m) {
    const upper = m.toUpperCase();
    if (!ALLOWED_METHODS.has(upper)) {
      throw new DomainError("VALIDATION", `unsupported method '${m}'`);
    }
    return upper;
  }
  // ─── EntityCrudService (M13 — generic entity-tools) ─────────────────────
  // Thin adapters over the rich methods above, always actor='agent' (the only
  // caller is entity-tools). Distinct names from createRaw/updateRaw/listRaw —
  // TS structurally allows an interface's `unknown`-typed params to widen to
  // a narrower concrete type, but two methods can't share one name with
  // different signatures, and the old rich signatures (actor/opts) must stay
  // intact for routes.ts and M17 restore.
  create(data) {
    const created = this.createRaw(data, "agent");
    return { slug: created.slug };
  }
  get(slug) {
    return this.getBySlug(slug);
  }
  /** `data.newSlug`, when present, renames — see EntityCrudService.update doc. */
  update(slug, data) {
    const updated = this.updateRaw(slug, data, "agent");
    return { slug: updated.slug };
  }
  delete(slug) {
    this.remove(slug, "agent");
  }
  list(opts) {
    const items = this.listRaw({ tags: opts.tags, tagFilter: opts.tagFilter, limit: opts.limit, offset: opts.offset });
    const total = this.count({ tags: opts.tags, tagFilter: opts.tagFilter });
    return { items, total };
  }
}
function createEndpointToolsServer(deps) {
  const ok = (payload) => ({
    content: [{ type: "text", text: JSON.stringify(payload) }]
  });
  const fail = (err) => {
    const code = err instanceof DomainError ? err.code : "INTERNAL";
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: JSON.stringify({ error: message, code }) }],
      isError: true
    };
  };
  const linkDto = mcpTool(
    "link_dto",
    "Link a DTO to an endpoint as request body, response, or error response. Optional HTTP status code for response/error. Idempotent.",
    {
      endpointSlug: z.string(),
      dtoSlug: z.string(),
      relation: z.enum(["request", "response", "error"]),
      statusCode: z.number().optional()
    },
    async (raw) => {
      const args = raw;
      try {
        deps.endpointService.linkDto(
          String(args.endpointSlug),
          String(args.dtoSlug),
          args.relation,
          args.statusCode ?? null
        );
        deps.ws.broadcast({ kind: "entity:changed", entityType: "endpoint", slug: String(args.endpointSlug) });
        return ok({ linked: true });
      } catch (err) {
        return fail(err);
      }
    }
  );
  const unlinkDto = mcpTool(
    "unlink_dto",
    "Remove a DTO link from an endpoint. Omit statusCode to remove all links (endpoint, dto, relation).",
    {
      endpointSlug: z.string(),
      dtoSlug: z.string(),
      relation: z.enum(["request", "response", "error"]),
      statusCode: z.number().optional()
    },
    async (raw) => {
      const args = raw;
      try {
        deps.endpointService.unlinkDto(
          String(args.endpointSlug),
          String(args.dtoSlug),
          args.relation,
          args.statusCode ?? null
        );
        deps.ws.broadcast({ kind: "entity:changed", entityType: "endpoint", slug: String(args.endpointSlug) });
        return ok({ unlinked: true });
      } catch (err) {
        return fail(err);
      }
    }
  );
  return createMcpServer({
    name: "endpoint-tools",
    tools: [linkDto, unlinkDto]
  });
}
const endpointCreateSchema = {
  method: z.string().describe("HTTP method: GET, POST, PUT, PATCH, DELETE"),
  path: z.string().describe("URL path, e.g. /api/users/:id"),
  summary: z.string().optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional()
};
const endpointUpdateSchema = {
  method: z.string().optional(),
  path: z.string().optional(),
  summary: z.string().optional(),
  description: z.string().nullable().optional(),
  tags: z.array(z.string()).optional()
};
const endpointMigrations = [
  {
    version: 1,
    name: "create_endpoint",
    up: `
      CREATE TABLE IF NOT EXISTS endpoint (
        slug TEXT PRIMARY KEY,
        method TEXT NOT NULL,
        path TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        description TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `
  },
  {
    version: 2,
    name: "create_endpoint_dto",
    up: `
      CREATE TABLE IF NOT EXISTS endpoint_dto (
        endpoint_slug TEXT NOT NULL REFERENCES endpoint(slug) ON DELETE CASCADE ON UPDATE CASCADE,
        dto_slug      TEXT NOT NULL REFERENCES dto(slug)      ON DELETE CASCADE ON UPDATE CASCADE,
        relation TEXT NOT NULL,
        status_code INTEGER,
        UNIQUE(endpoint_slug, dto_slug, relation, status_code)
      );
      CREATE INDEX IF NOT EXISTS idx_endpoint_dto_endpoint ON endpoint_dto(endpoint_slug);
      CREATE INDEX IF NOT EXISTS idx_endpoint_dto_dto      ON endpoint_dto(dto_slug);
    `
  }
];
const endpointEntity = {
  type: ENDPOINT_TYPE,
  table: ENDPOINT_TABLE,
  label: "Endpoint",
  labelPlural: "Endpoints",
  displayOrder: ENDPOINT_DISPLAY_ORDER,
  pathPrefix: ENDPOINT_PATH_PREFIX,
  /**
   * Restore and index order is declared here, by the module that knows the
   * constraint. An endpoint links DTOs through the junction, so DTO rows must
   * exist first or the FK rejects the link. "DTO before Endpoint" is the RESULT
   * of this line; the host's topological sort only consumes it.
   */
  dependsOn: ["dto"],
  slugFrom: (data) => {
    const d = data;
    return endpointSlug(d.method ?? "GET", d.path ?? "");
  },
  serializer: endpointSerializer,
  systemPrompt: endpointSystemPrompt,
  backend: {
    migrations: endpointMigrations,
    /**
     * The junction's rows are derived from the endpoint files' `linked_dtos[]`,
     * so a full index rebuild must clear it before repopulating. Declared rather
     * than hardcoded in the host indexer, which has no idea this table exists.
     */
    auxTables: [ENDPOINT_DTO_TABLE],
    /**
     * A DTO rename cascades through the junction's ON UPDATE CASCADE, but the
     * endpoint FILES still embed the old slug in `linked_dtos[]`. Re-persist the
     * affected ones. This was a `type === 'dto'` branch in the host's
     * ReferencesService — knowledge belonging to whoever owns the link.
     */
    onEntityRenamed: ({ type, newSlug }, ctx) => {
      if (type !== "dto") return;
      const affected = ctx.db.prepare(`SELECT DISTINCT endpoint_slug AS slug FROM ${ENDPOINT_DTO_TABLE} WHERE dto_slug = ?`).all(newSlug);
      for (const e of affected) {
        try {
          ctx.entityStore.persist(ENDPOINT_TYPE, e.slug);
        } catch {
        }
      }
    },
    service: (ctx) => new EndpointService(ctx.db, ctx.tagsService, ctx.versionService, ctx.entityStore),
    crud: { createSchema: endpointCreateSchema, updateSchema: endpointUpdateSchema },
    routes: {
      router: (service, ctx) => endpointsRouter(service, ctx.referencesService)
    },
    mcpServer: (service, ctx) => createEndpointToolsServer({ endpointService: service, ws: ctx.ws })
  }
};
const manifest = {
  name: "c4s-plugin-api-contracts",
  version: "0.2.2",
  hostApiVersion: "^1.0.0",
  engines: { node: ">=20" },
  contributes: {
    entities: [dtoEntity, endpointEntity]
  },
  /**
   * Nothing to tear down. The two services hold no timers, watchers or open
   * handles — every resource they touch belongs to the `ProjectContext` the
   * host disposes itself. Declared explicitly rather than omitted so a future
   * subscription has an obvious home.
   */
  onUnregister: () => {
  }
};
export {
  manifest as default,
  manifest
};
//# sourceMappingURL=index.js.map
