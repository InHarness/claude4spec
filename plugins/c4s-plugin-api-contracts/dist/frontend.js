import { useTags, useReferences, clientPluginHost, registerFrontendModule } from "@c4s/plugin-runtime";
import { jsx, jsxs, Fragment } from "react/jsx-runtime";
import { Plus, X, GripVertical, ChevronDown, Pencil, Copy, Trash, Braces, FileText, History, ChevronRight, Database, Monitor, ArrowRightLeft } from "lucide-react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Badge, FieldRow, FieldGrid, TagPicker, DocEditor, ActionButton, Dialog, FormShell, FormField, EntityListHeader, EntityListLayout, LoadingState, EmptyState, TagFilterBar, EntityListRow, EntityVersionHistoryView, EnumBadgePicker, GroupedRelationPicker } from "@c4s/plugin-runtime/ui";
import { useState, useRef, useEffect, useMemo, lazy, Suspense, forwardRef } from "react";
import { t as tagSlug, D as DTO_PATH_PREFIX, c as DTO_TYPE, g as ENDPOINT_PATH_PREFIX, e as ENDPOINT_TYPE } from "./identity-BkDoU8yY.js";
import { useNavigate, createRoute, useSearch, useParams } from "@tanstack/react-router";
const PROJECT_ID = typeof window !== "undefined" && window.__C4S_PROJECT__?.id || "";
const API_BASE = PROJECT_ID ? `/api/projects/${PROJECT_ID}` : "/api";
function apiFetch(input, init) {
  if (typeof input === "string" && input.startsWith("/api/")) {
    return fetch(`${API_BASE}${input.slice("/api".length)}`, init);
  }
  return fetch(input, init);
}
class ApiError extends Error {
  constructor(code, message, status, details) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}
async function handle(res) {
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message = body?.error?.message ?? res.statusText;
    const code = body?.error?.code ?? "HTTP_ERROR";
    throw new ApiError(code, message, res.status, body?.error);
  }
  return res.json();
}
const dtosApi = {
  async list(query = {}) {
    const params = new URLSearchParams();
    if (query.search) params.set("search", query.search);
    if (query.tags?.length) params.set("tags", query.tags.join(","));
    if (query.tagFilter) params.set("tagFilter", query.tagFilter);
    if (query.limit) params.set("limit", String(query.limit));
    if (query.offset) params.set("offset", String(query.offset));
    const q = params.toString() ? `?${params.toString()}` : "";
    const data = await handle(await apiFetch(`/api/dtos${q}`));
    return data.dtos;
  },
  async get(slug) {
    return handle(await apiFetch(`/api/dtos/${encodeURIComponent(slug)}`));
  },
  async create(input) {
    return handle(
      await apiFetch("/api/dtos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input)
      })
    );
  },
  async update(slug, input) {
    return handle(
      await apiFetch(`/api/dtos/${encodeURIComponent(slug)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input)
      })
    );
  },
  async remove(slug) {
    return handle(
      await apiFetch(`/api/dtos/${encodeURIComponent(slug)}`, { method: "DELETE" })
    );
  }
};
const keys$1 = {
  all: ["dtos"],
  list: (q) => ["dtos", "list", q],
  detail: (slug) => ["dto", slug]
};
function useDtos(query = {}) {
  return useQuery({
    queryKey: keys$1.list(query),
    queryFn: () => dtosApi.list(query)
  });
}
function useDto(slug) {
  return useQuery({
    queryKey: slug ? keys$1.detail(slug) : ["dto", "none"],
    queryFn: () => dtosApi.get(slug),
    enabled: Boolean(slug)
  });
}
function useCreateDto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input) => dtosApi.create(input),
    onSuccess: (dto) => {
      qc.invalidateQueries({ queryKey: keys$1.all });
      qc.setQueryData(keys$1.detail(dto.slug), dto);
    }
  });
}
function useUpdateDto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, input }) => dtosApi.update(slug, input),
    onSuccess: (dto, { slug }) => {
      qc.invalidateQueries({ queryKey: keys$1.all });
      if (slug !== dto.slug) qc.removeQueries({ queryKey: keys$1.detail(slug) });
      qc.setQueryData(keys$1.detail(dto.slug), dto);
      qc.invalidateQueries({ queryKey: ["versions", "dto", dto.slug] });
      qc.invalidateQueries({ queryKey: ["tags"] });
      qc.invalidateQueries({ queryKey: ["pages"] });
    }
  });
}
function useDeleteDto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (slug) => dtosApi.remove(slug),
    onSuccess: (_data, slug) => {
      qc.invalidateQueries({ queryKey: keys$1.all });
      qc.removeQueries({ queryKey: keys$1.detail(slug) });
      qc.invalidateQueries({ queryKey: ["tags"] });
    }
  });
}
const METHOD_STYLE = {
  GET: { bg: "var(--c-blue-soft)", fg: "var(--c-blue)", label: "GET" },
  POST: { bg: "var(--c-green-soft)", fg: "var(--c-green)", label: "POST" },
  PUT: { bg: "var(--c-purple-soft)", fg: "var(--c-purple)", label: "PUT" },
  PATCH: { bg: "var(--c-yellow)", fg: "var(--c-yellow-ink)", label: "PATCH" },
  DELETE: { bg: "var(--c-red-soft)", fg: "var(--c-red)", label: "DEL" }
};
function MethodChip({ method, large = false }) {
  const s = METHOD_STYLE[method] ?? METHOD_STYLE.GET;
  return /* @__PURE__ */ jsx(
    Badge,
    {
      label: s.label,
      color: s.bg,
      foreground: s.fg,
      active: true,
      dot: false,
      mono: true,
      small: !large,
      minWidth: large ? 56 : 42
    }
  );
}
function useEntityDraftEditor({ entity, toDraft: toDraft2, save }) {
  const [draft, setDraft] = useState(null);
  const baselineRef = useRef(null);
  const saveTimer = useRef(null);
  useEffect(() => {
    if (!entity) return;
    const next = toDraft2(entity);
    const snapshot = JSON.stringify(next);
    if (baselineRef.current === snapshot) return;
    baselineRef.current = snapshot;
    setDraft(next);
  }, [entity]);
  useEffect(
    () => () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    },
    []
  );
  const dirty = useMemo(() => {
    if (!draft || !entity) return false;
    return JSON.stringify(draft) !== baselineRef.current;
  }, [draft, entity]);
  async function runSave(current) {
    if (!entity) return;
    try {
      const updated = await save(current, entity);
      baselineRef.current = JSON.stringify(toDraft2(updated));
    } catch (err) {
      console.error("autosave failed", err);
    }
  }
  function scheduleAutosave(next) {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void runSave(next), 500);
  }
  function patch(partial) {
    setDraft((d) => {
      if (!d) return d;
      const next = { ...d, ...partial };
      scheduleAutosave(next);
      return next;
    });
  }
  return { draft, dirty, patch };
}
const TOAST_EVENT = "c4s:toast";
const CONFIRM_EVENT = "c4s:confirm-open";
function fire(kind, message, options) {
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: { kind, message, ...options } }));
}
const toast = {
  success: (message, options) => fire("success", message, options),
  error: (message, options) => fire("error", message, options),
  warning: (message, options) => fire("warning", message, options),
  info: (message, options) => fire("info", message, options)
};
function confirmDestructive(input) {
  return new Promise((resolve) => {
    window.dispatchEvent(new CustomEvent(CONFIRM_EVENT, { detail: { ...input, resolve } }));
  });
}
const MonacoEditor = lazy(
  () => import("./index-BOucLvzV.js").then((m) => ({ default: m.default }))
);
function MonacoJsonEditor({ value, onChange, readOnly = false, height = 240 }) {
  return /* @__PURE__ */ jsx(
    Suspense,
    {
      fallback: /* @__PURE__ */ jsx(
        "textarea",
        {
          value,
          readOnly: true,
          className: "w-full font-mono text-[12.5px] p-2",
          style: {
            background: "var(--c-panel)",
            color: "var(--c-muted)",
            border: "1px solid var(--c-hair)",
            height
          }
        }
      ),
      children: /* @__PURE__ */ jsx(
        "div",
        {
          className: "rounded",
          style: { border: "1px solid var(--c-hair)", overflow: "hidden" },
          children: /* @__PURE__ */ jsx(
            MonacoEditor,
            {
              height,
              defaultLanguage: "json",
              value,
              onChange: (v) => onChange(v ?? ""),
              options: {
                readOnly,
                minimap: { enabled: false },
                fontSize: 12.5,
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                lineNumbers: "off",
                folding: false,
                scrollBeyondLastLine: false,
                wordWrap: "on",
                tabSize: 2,
                renderLineHighlight: "none",
                overviewRulerLanes: 0,
                hideCursorInOverviewRuler: true,
                scrollbar: { verticalScrollbarSize: 6, horizontalScrollbarSize: 6 }
              }
            }
          )
        }
      )
    }
  );
}
function validateExampleAgainstFields(value, fields) {
  if (!fields.length) return [];
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return [{ field: "<root>", expected: "object", got: describe(value) }];
  }
  const obj = value;
  const warnings = [];
  for (const f of fields) {
    const present = Object.prototype.hasOwnProperty.call(obj, f.name);
    if (f.required && !present) {
      warnings.push({ field: f.name, expected: f.type, got: "missing" });
      continue;
    }
    if (!present) continue;
    const v = obj[f.name];
    if (v === null) continue;
    const expected = baseType(f.type);
    const got = describe(v);
    if (expected && got !== expected && expected !== "any") {
      warnings.push({ field: f.name, expected: f.type, got });
    }
  }
  return warnings;
}
function baseType(rawType) {
  const t = rawType.replace(/\[\]$/, "").trim().toLowerCase();
  if (rawType.endsWith("[]")) return "array";
  if (["string", "number", "boolean", "object", "array", "any"].includes(t)) return t;
  return "";
}
function describe(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}
function buildExampleTemplate(fields) {
  if (!fields.length) return {};
  const obj = {};
  for (const f of fields) {
    obj[f.name] = defaultForType(f.type);
  }
  return obj;
}
function defaultForType(t) {
  if (t.endsWith("[]")) return [];
  const lower = t.trim().toLowerCase();
  if (lower === "string") return "";
  if (lower === "number" || lower === "integer") return 0;
  if (lower === "boolean") return false;
  if (lower === "object") return {};
  return null;
}
function defaultRowState(value) {
  return {
    expanded: false,
    editingMeta: false,
    editing: false,
    rawJson: pretty(value),
    parseError: null
  };
}
function pretty(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "";
  }
}
function ExamplesPanel({ examples, fields, onChange }) {
  const [adding, setAdding] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftSummary, setDraftSummary] = useState("");
  const [draftJson, setDraftJson] = useState("");
  const [draftError, setDraftError] = useState(null);
  const [rows, setRows] = useState({});
  const [dragIdx, setDragIdx] = useState(null);
  const usedNames = useMemo(() => new Set(examples.map((e) => e.name)), [examples]);
  function rowState(i) {
    return rows[i] ?? defaultRowState(examples[i]?.value);
  }
  function setRow(i, partial) {
    setRows((prev) => ({ ...prev, [i]: { ...rowState(i), ...partial } }));
  }
  function startAdd() {
    setAdding(true);
    setDraftName("");
    setDraftSummary("");
    setDraftJson(pretty(buildExampleTemplate(fields)));
    setDraftError(null);
  }
  function cancelAdd() {
    setAdding(false);
    setDraftError(null);
  }
  function submitAdd() {
    const name = draftName.trim();
    if (!name) {
      setDraftError("name is required");
      return;
    }
    if (usedNames.has(name)) {
      setDraftError(`example '${name}' already exists`);
      return;
    }
    let value;
    try {
      value = JSON.parse(draftJson || "null");
    } catch (err) {
      setDraftError(`invalid JSON: ${err.message}`);
      return;
    }
    const next = {
      name,
      value,
      ...draftSummary.trim() ? { summary: draftSummary.trim() } : {}
    };
    onChange([...examples, next]);
    cancelAdd();
  }
  function updateExample(i, partial) {
    onChange(examples.map((ex, idx) => idx === i ? { ...ex, ...partial } : ex));
  }
  function commitJsonEdit(i) {
    const st = rowState(i);
    let parsed;
    try {
      parsed = JSON.parse(st.rawJson || "null");
    } catch (err) {
      setRow(i, { parseError: err.message });
      return;
    }
    setRow(i, { parseError: null, editing: false });
    updateExample(i, { value: parsed });
  }
  async function removeExample(i) {
    const ex = examples[i];
    if (!ex) return;
    const ok = await confirmDestructive({
      title: "Delete example?",
      body: `Delete example '${ex.name}'?`,
      confirmLabel: "Delete"
    });
    if (!ok) return;
    const next = examples.filter((_, idx) => idx !== i);
    onChange(next);
    setRows((prev) => {
      const out = {};
      Object.entries(prev).forEach(([k, v]) => {
        const idx = Number(k);
        if (idx === i) return;
        out[idx > i ? idx - 1 : idx] = v;
      });
      return out;
    });
  }
  function duplicateExample(i) {
    const ex = examples[i];
    if (!ex) return;
    let suffix = 2;
    let candidate = `${ex.name}-copy`;
    while (usedNames.has(candidate)) {
      candidate = `${ex.name}-copy-${suffix++}`;
    }
    const next = {
      name: candidate,
      value: clone(ex.value),
      ...ex.summary ? { summary: ex.summary } : {}
    };
    onChange([...examples.slice(0, i + 1), next, ...examples.slice(i + 1)]);
  }
  function reorder(from, to) {
    if (from === to) return;
    const next = examples.slice();
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    next.splice(to, 0, moved);
    onChange(next);
    setRows({});
  }
  return /* @__PURE__ */ jsxs("div", { children: [
    /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2 mb-2", children: [
      /* @__PURE__ */ jsx(SectionLabel, { children: "Examples" }),
      /* @__PURE__ */ jsx("span", { className: "flex-1" }),
      !adding && /* @__PURE__ */ jsxs(
        "button",
        {
          onClick: startAdd,
          className: "inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded",
          style: { color: "var(--c-muted)", border: "1px dashed var(--c-hair-strong)" },
          children: [
            /* @__PURE__ */ jsx(Plus, { size: 11 }),
            " add example"
          ]
        }
      )
    ] }),
    !adding && examples.length === 0 && /* @__PURE__ */ jsx("div", { className: "text-[12.5px]", style: { color: "var(--c-subtle)" }, children: "No examples yet. Add one to document a typical payload." }),
    adding && /* @__PURE__ */ jsxs(
      "div",
      {
        className: "rounded-md p-3 mb-2",
        style: { background: "var(--c-panel)", border: "1px solid var(--c-hair)" },
        children: [
          /* @__PURE__ */ jsxs("div", { className: "flex items-center mb-2", children: [
            /* @__PURE__ */ jsx("span", { className: "flex-1" }),
            /* @__PURE__ */ jsx(
              "button",
              {
                onClick: cancelAdd,
                className: "text-[11px] px-2 py-0.5 rounded",
                style: { color: "var(--c-subtle)" },
                children: /* @__PURE__ */ jsx(X, { size: 12 })
              }
            )
          ] }),
          /* @__PURE__ */ jsxs("div", { className: "flex flex-col gap-2", children: [
            /* @__PURE__ */ jsx(FieldRow, { label: "name", children: /* @__PURE__ */ jsx(
              "input",
              {
                autoFocus: true,
                value: draftName,
                onChange: (e) => {
                  setDraftName(e.target.value);
                  if (draftError) setDraftError(null);
                },
                className: "font-mono text-[12.5px] bg-transparent outline-none w-full",
                style: { color: "var(--c-ink)" },
                placeholder: 'name (e.g. "minimal")',
                spellCheck: false
              }
            ) }),
            /* @__PURE__ */ jsx(FieldRow, { label: "summary", children: /* @__PURE__ */ jsx(
              "input",
              {
                value: draftSummary,
                onChange: (e) => setDraftSummary(e.target.value),
                className: "text-[12.5px] bg-transparent outline-none w-full",
                style: { color: "var(--c-muted)" },
                placeholder: "summary (optional)"
              }
            ) }),
            /* @__PURE__ */ jsxs(FieldRow, { label: "value", align: "start", children: [
              /* @__PURE__ */ jsx(MonacoJsonEditor, { value: draftJson, onChange: setDraftJson, height: 200 }),
              draftError && /* @__PURE__ */ jsx("div", { className: "mt-1 text-[11px]", style: { color: "var(--c-red, #c45a3b)" }, children: draftError })
            ] })
          ] }),
          /* @__PURE__ */ jsx("div", { className: "flex justify-end mt-2", children: /* @__PURE__ */ jsx(
            "button",
            {
              onClick: submitAdd,
              className: "text-[12px] px-3 py-1 rounded",
              style: {
                background: "var(--c-accent)",
                color: "var(--c-paper, #fff)"
              },
              children: "Add"
            }
          ) })
        ]
      }
    ),
    examples.length > 0 && /* @__PURE__ */ jsx(
      "div",
      {
        className: "rounded-md",
        style: { background: "var(--c-panel)", border: "1px solid var(--c-hair)" },
        children: examples.map((ex, i) => {
          const st = rowState(i);
          const warnings = st.expanded ? validateExampleAgainstFields(ex.value, fields) : [];
          return /* @__PURE__ */ jsxs(
            "div",
            {
              draggable: true,
              onDragStart: () => setDragIdx(i),
              onDragOver: (e) => e.preventDefault(),
              onDrop: () => {
                if (dragIdx !== null) reorder(dragIdx, i);
                setDragIdx(null);
              },
              style: {
                borderBottom: i === examples.length - 1 ? "none" : "1px solid var(--c-hair)"
              },
              children: [
                /* @__PURE__ */ jsxs(
                  "div",
                  {
                    className: "flex items-center gap-2 px-2 py-1.5",
                    style: { cursor: "pointer" },
                    onClick: () => setRow(i, { expanded: !st.expanded }),
                    children: [
                      /* @__PURE__ */ jsx(GripVertical, { size: 12, style: { color: "var(--c-subtle)", cursor: "grab" } }),
                      /* @__PURE__ */ jsx(
                        ChevronDown,
                        {
                          size: 12,
                          style: {
                            color: "var(--c-subtle)",
                            transform: st.expanded ? "rotate(0deg)" : "rotate(-90deg)",
                            transition: "transform 80ms"
                          }
                        }
                      ),
                      st.editingMeta ? /* @__PURE__ */ jsx(
                        ExampleMetaEditor,
                        {
                          example: ex,
                          otherNames: new Set([...usedNames].filter((n) => n !== ex.name)),
                          onCancel: (e) => {
                            e?.stopPropagation();
                            setRow(i, { editingMeta: false });
                          },
                          onSave: (next, e) => {
                            e?.stopPropagation();
                            updateExample(i, next);
                            setRow(i, { editingMeta: false });
                          }
                        }
                      ) : /* @__PURE__ */ jsxs(Fragment, { children: [
                        /* @__PURE__ */ jsx(
                          "span",
                          {
                            className: "font-mono text-[12.5px]",
                            style: { color: "var(--c-ink)", minWidth: 96 },
                            children: ex.name
                          }
                        ),
                        /* @__PURE__ */ jsx(
                          "span",
                          {
                            className: "text-[12px] flex-1 truncate",
                            style: { color: "var(--c-subtle)" },
                            children: ex.summary ?? ""
                          }
                        )
                      ] }),
                      !st.editingMeta && /* @__PURE__ */ jsx(
                        RowActions,
                        {
                          onEdit: (e) => {
                            e.stopPropagation();
                            setRow(i, { editingMeta: true, expanded: true });
                          },
                          onDuplicate: (e) => {
                            e.stopPropagation();
                            duplicateExample(i);
                          },
                          onDelete: (e) => {
                            e.stopPropagation();
                            void removeExample(i);
                          }
                        }
                      )
                    ]
                  }
                ),
                st.expanded && /* @__PURE__ */ jsx("div", { className: "px-2 pb-2", children: /* @__PURE__ */ jsxs(FieldRow, { align: "start", label: "value", children: [
                  /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2 mb-1", children: [
                    /* @__PURE__ */ jsx("span", { className: "flex-1" }),
                    !st.editing && /* @__PURE__ */ jsxs(
                      "button",
                      {
                        onClick: () => setRow(i, { editing: true, rawJson: pretty(ex.value), parseError: null }),
                        className: "inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded",
                        style: { color: "var(--c-muted)" },
                        children: [
                          /* @__PURE__ */ jsx(Pencil, { size: 10 }),
                          " edit"
                        ]
                      }
                    ),
                    st.editing && /* @__PURE__ */ jsxs(Fragment, { children: [
                      /* @__PURE__ */ jsx(
                        "button",
                        {
                          onClick: () => setRow(i, {
                            editing: false,
                            rawJson: pretty(ex.value),
                            parseError: null
                          }),
                          className: "text-[11px] px-1.5 py-0.5 rounded",
                          style: { color: "var(--c-subtle)" },
                          children: "cancel"
                        }
                      ),
                      /* @__PURE__ */ jsx(
                        "button",
                        {
                          onClick: () => commitJsonEdit(i),
                          className: "text-[11px] px-2 py-0.5 rounded",
                          style: { background: "var(--c-accent)", color: "var(--c-paper, #fff)" },
                          children: "save"
                        }
                      )
                    ] })
                  ] }),
                  /* @__PURE__ */ jsx(
                    MonacoJsonEditor,
                    {
                      value: st.editing ? st.rawJson : pretty(ex.value),
                      onChange: (v) => setRow(i, { rawJson: v, parseError: null }),
                      readOnly: !st.editing,
                      height: 220
                    }
                  ),
                  st.parseError && /* @__PURE__ */ jsxs("div", { className: "mt-1 text-[11px]", style: { color: "var(--c-red, #c45a3b)" }, children: [
                    "invalid JSON: ",
                    st.parseError
                  ] }),
                  !st.editing && warnings.length > 0 && /* @__PURE__ */ jsxs(
                    "div",
                    {
                      className: "mt-1 text-[11px] px-2 py-1 rounded",
                      style: {
                        background: "var(--c-warn-bg, #fdf6e3)",
                        color: "var(--c-warn-ink, #8a6d3b)",
                        border: "1px solid var(--c-warn-border, #e7d9b3)"
                      },
                      children: [
                        "Example doesn't match fields:",
                        warnings.map((w) => /* @__PURE__ */ jsxs("div", { children: [
                          /* @__PURE__ */ jsx("span", { className: "font-mono", children: w.field }),
                          ": expected ",
                          w.expected,
                          ", got ",
                          w.got
                        ] }, w.field))
                      ]
                    }
                  )
                ] }) })
              ]
            },
            `${ex.name}-${i}`
          );
        })
      }
    )
  ] });
}
function RowActions({
  onEdit,
  onDuplicate,
  onDelete
}) {
  return /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-1", children: [
    /* @__PURE__ */ jsx(
      "button",
      {
        onClick: onEdit,
        className: "text-[11px] px-1.5 py-0.5 rounded",
        style: { color: "var(--c-subtle)" },
        title: "Edit name/summary",
        children: /* @__PURE__ */ jsx(Pencil, { size: 11 })
      }
    ),
    /* @__PURE__ */ jsx(
      "button",
      {
        onClick: onDuplicate,
        className: "text-[11px] px-1.5 py-0.5 rounded",
        style: { color: "var(--c-subtle)" },
        title: "Duplicate",
        children: /* @__PURE__ */ jsx(Copy, { size: 11 })
      }
    ),
    /* @__PURE__ */ jsx(
      "button",
      {
        onClick: onDelete,
        className: "text-[11px] px-1.5 py-0.5 rounded",
        style: { color: "var(--c-red, #c45a3b)" },
        title: "Delete",
        children: /* @__PURE__ */ jsx(Trash, { size: 11 })
      }
    )
  ] });
}
function ExampleMetaEditor({
  example,
  otherNames,
  onSave,
  onCancel
}) {
  const [name, setName] = useState(example.name);
  const [summary, setSummary] = useState(example.summary ?? "");
  const [error, setError] = useState(null);
  function commit(e) {
    e.stopPropagation();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("name is required");
      return;
    }
    if (otherNames.has(trimmed)) {
      setError(`name '${trimmed}' already exists`);
      return;
    }
    onSave(
      {
        name: trimmed,
        ...summary.trim() ? { summary: summary.trim() } : { summary: void 0 }
      },
      e
    );
  }
  return /* @__PURE__ */ jsxs(Fragment, { children: [
    /* @__PURE__ */ jsx(
      "input",
      {
        autoFocus: true,
        value: name,
        onChange: (e) => {
          setName(e.target.value);
          if (error) setError(null);
        },
        onClick: (e) => e.stopPropagation(),
        className: "font-mono text-[12.5px] bg-transparent outline-none",
        style: { color: "var(--c-ink)", minWidth: 96 },
        spellCheck: false
      }
    ),
    /* @__PURE__ */ jsx(
      "input",
      {
        value: summary,
        onChange: (e) => setSummary(e.target.value),
        onClick: (e) => e.stopPropagation(),
        className: "text-[12px] bg-transparent outline-none flex-1",
        style: { color: "var(--c-muted)" },
        placeholder: "summary (optional)"
      }
    ),
    error && /* @__PURE__ */ jsx("span", { className: "text-[11px]", style: { color: "var(--c-red, #c45a3b)" }, children: error }),
    /* @__PURE__ */ jsx(
      "button",
      {
        onClick: commit,
        className: "text-[11px] px-2 py-0.5 rounded",
        style: { background: "var(--c-accent)", color: "var(--c-paper, #fff)" },
        children: "save"
      }
    ),
    /* @__PURE__ */ jsx(
      "button",
      {
        onClick: (e) => onCancel(e),
        className: "text-[11px] px-1.5 py-0.5 rounded",
        style: { color: "var(--c-subtle)" },
        children: /* @__PURE__ */ jsx(X, { size: 11 })
      }
    )
  ] });
}
function SectionLabel({ children }) {
  return /* @__PURE__ */ jsx(
    "div",
    {
      className: "text-[10.5px] uppercase font-mono tracking-wider",
      style: { color: "var(--c-subtle)" },
      children
    }
  );
}
function clone(v) {
  try {
    return JSON.parse(JSON.stringify(v));
  } catch {
    return v;
  }
}
function toDraft$1(d) {
  return {
    name: d.name,
    description: d.description ?? "",
    fields: d.fields,
    examples: d.examples,
    tags: d.tags
  };
}
function DtoDetail({
  slug,
  onDeleted,
  onRenamed,
  onOpenEntity,
  onOpenPage
}) {
  const { data: dto, isLoading, error } = useDto(slug);
  const update = useUpdateDto();
  const remove = useDeleteDto();
  const { data: allTags = [] } = useTags();
  const { data: refs = [] } = useReferences("dto", dto?.slug ?? null);
  const { draft, dirty, patch } = useEntityDraftEditor({
    entity: dto,
    toDraft: toDraft$1,
    save: async (current, d) => {
      const updated = await update.mutateAsync({
        slug: d.slug,
        input: {
          name: current.name,
          description: current.description || null,
          fields: current.fields,
          examples: current.examples,
          tags: current.tags
        }
      });
      if (updated.slug !== d.slug) onRenamed(updated.slug);
      return updated;
    }
  });
  async function handleDelete() {
    if (!dto) return;
    const ok = await confirmDestructive({
      title: "Delete DTO?",
      body: `Delete DTO ${dto.name}? All references to this DTO will become broken.`,
      confirmLabel: "Delete"
    });
    if (!ok) return;
    try {
      await remove.mutateAsync(dto.slug);
      onDeleted();
      toast.success(`DTO ${dto.name} deleted`);
    } catch (err) {
      toast.error(err.message);
    }
  }
  function toggleTag(tagSlug2) {
    if (!draft) return;
    const next = draft.tags.includes(tagSlug2) ? draft.tags.filter((t) => t !== tagSlug2) : [...draft.tags, tagSlug2];
    patch({ tags: next });
  }
  function handleCreateTag(name) {
    if (!draft) return;
    const slug2 = tagSlug(name);
    if (!slug2 || draft.tags.includes(slug2)) return;
    patch({ tags: [...draft.tags, slug2] });
  }
  function updateField(index, partial) {
    if (!draft) return;
    const fields = draft.fields.map((f, i) => i === index ? { ...f, ...partial } : f);
    patch({ fields });
  }
  function removeField(index) {
    if (!draft) return;
    patch({ fields: draft.fields.filter((_, i) => i !== index) });
  }
  function addField() {
    if (!draft) return;
    patch({ fields: [...draft.fields, { name: "", type: "string", required: false }] });
  }
  if (isLoading && !dto) {
    return /* @__PURE__ */ jsx("div", { className: "p-8 text-[13px]", style: { color: "var(--c-subtle)" }, children: "Loading DTO…" });
  }
  if (error) {
    return /* @__PURE__ */ jsxs("div", { className: "p-8 text-[13px]", style: { color: "var(--c-red)" }, children: [
      "Failed to load: ",
      error.message
    ] });
  }
  if (!dto || !draft) return null;
  return /* @__PURE__ */ jsx("div", { className: "flex-1 overflow-auto nice-scroll", children: /* @__PURE__ */ jsxs(FieldGrid, { maxWidth: 740, children: [
    /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2 mb-1 text-[11px]", style: { color: "var(--c-subtle)" }, children: [
      /* @__PURE__ */ jsx("span", { className: "font-mono", children: dto.slug }),
      /* @__PURE__ */ jsx("span", { children: "·" }),
      /* @__PURE__ */ jsxs("span", { children: [
        "updated",
        " ",
        (/* @__PURE__ */ new Date(dto.updatedAt.replace(" ", "T") + "Z")).toLocaleString(void 0, {
          dateStyle: "medium",
          timeStyle: "short"
        })
      ] }),
      update.isPending && /* @__PURE__ */ jsx("span", { style: { color: "var(--c-accent-ink, var(--c-accent))" }, children: "saving…" }),
      !update.isPending && dirty && /* @__PURE__ */ jsx("span", { style: { color: "var(--c-accent-ink, var(--c-accent))" }, children: "edited" }),
      /* @__PURE__ */ jsx("span", { className: "flex-1" }),
      /* @__PURE__ */ jsxs(
        "button",
        {
          onClick: handleDelete,
          className: "inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px]",
          style: { color: "var(--c-red, #c45a3b)" },
          title: "Delete",
          children: [
            /* @__PURE__ */ jsx(Trash, { size: 11 }),
            " Delete"
          ]
        }
      )
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2 mt-2 mb-1", children: [
      /* @__PURE__ */ jsx(Braces, { size: 22, style: { color: "var(--c-accent)" } }),
      /* @__PURE__ */ jsx(
        "input",
        {
          value: draft.name,
          onChange: (e) => patch({ name: e.target.value }),
          className: "flex-1 bg-transparent outline-none",
          style: {
            fontSize: 28,
            fontWeight: 600,
            color: "var(--c-ink)"
          },
          placeholder: "DTOName",
          spellCheck: false
        }
      )
    ] }),
    /* @__PURE__ */ jsx(FieldRow, { label: "Tags", children: /* @__PURE__ */ jsx(
      TagPicker,
      {
        allTags,
        selected: draft.tags,
        onToggle: toggleTag,
        onCreate: handleCreateTag,
        variant: "collapsed"
      }
    ) }),
    /* @__PURE__ */ jsx("div", { className: "mt-6", children: /* @__PURE__ */ jsx(FieldRow, { label: "Description", align: "start", children: /* @__PURE__ */ jsx(
      DocEditor,
      {
        value: draft.description,
        onChange: (md) => patch({ description: md }),
        placeholder: "What this DTO represents, which endpoints use it, invariants…"
      }
    ) }) }),
    /* @__PURE__ */ jsx("div", { className: "mt-6", children: /* @__PURE__ */ jsxs(FieldRow, { label: "Fields", align: "start", children: [
      /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2 mb-2", children: [
        /* @__PURE__ */ jsx("span", { className: "flex-1" }),
        /* @__PURE__ */ jsx(ActionButton, { label: "add field", icon: /* @__PURE__ */ jsx(Plus, { size: 11 }), variant: "secondary", onClick: addField })
      ] }),
      draft.fields.length === 0 && /* @__PURE__ */ jsx("div", { className: "text-[12.5px]", style: { color: "var(--c-subtle)" }, children: "No fields defined yet." }),
      draft.fields.length > 0 && /* @__PURE__ */ jsxs(
        "div",
        {
          className: "rounded-md",
          style: { background: "var(--c-panel)", border: "1px solid var(--c-hair)" },
          children: [
            /* @__PURE__ */ jsxs(
              "div",
              {
                className: "grid gap-2 px-3 py-1.5 text-[10.5px] uppercase font-mono tracking-wider",
                style: {
                  gridTemplateColumns: "1.5fr 1.2fr 0.6fr 2fr 28px",
                  color: "var(--c-subtle)",
                  borderBottom: "1px solid var(--c-hair)"
                },
                children: [
                  /* @__PURE__ */ jsx("span", { children: "name" }),
                  /* @__PURE__ */ jsx("span", { children: "type" }),
                  /* @__PURE__ */ jsx("span", { children: "req" }),
                  /* @__PURE__ */ jsx("span", { children: "description" }),
                  /* @__PURE__ */ jsx("span", {})
                ]
              }
            ),
            draft.fields.map((f, i) => /* @__PURE__ */ jsxs(
              "div",
              {
                className: "grid gap-2 px-3 py-1.5 items-center",
                style: {
                  gridTemplateColumns: "1.5fr 1.2fr 0.6fr 2fr 28px",
                  borderBottom: i === draft.fields.length - 1 ? "none" : "1px solid var(--c-hair)"
                },
                children: [
                  /* @__PURE__ */ jsx(
                    "input",
                    {
                      value: f.name,
                      onChange: (e) => updateField(i, { name: e.target.value }),
                      className: "font-mono text-[12.5px] bg-transparent outline-none",
                      style: { color: "var(--c-ink)" },
                      placeholder: "fieldName",
                      spellCheck: false
                    }
                  ),
                  /* @__PURE__ */ jsx(
                    "input",
                    {
                      value: f.type,
                      onChange: (e) => updateField(i, { type: e.target.value }),
                      className: "font-mono text-[12.5px] bg-transparent outline-none",
                      style: { color: "var(--c-muted)" },
                      placeholder: "string",
                      spellCheck: false
                    }
                  ),
                  /* @__PURE__ */ jsx(
                    "input",
                    {
                      type: "checkbox",
                      checked: f.required,
                      onChange: (e) => updateField(i, { required: e.target.checked })
                    }
                  ),
                  /* @__PURE__ */ jsx(
                    "input",
                    {
                      value: f.description ?? "",
                      onChange: (e) => updateField(i, { description: e.target.value }),
                      className: "text-[12.5px] bg-transparent outline-none",
                      style: { color: "var(--c-muted)" },
                      placeholder: "field description"
                    }
                  ),
                  /* @__PURE__ */ jsx(
                    "button",
                    {
                      onClick: () => removeField(i),
                      className: "text-[12px]",
                      style: { color: "var(--c-subtle)" },
                      title: "Remove field",
                      children: "×"
                    }
                  )
                ]
              },
              i
            ))
          ]
        }
      )
    ] }) }),
    /* @__PURE__ */ jsx("div", { className: "mt-6", children: /* @__PURE__ */ jsx(
      ExamplesPanel,
      {
        examples: draft.examples,
        fields: draft.fields,
        onChange: (examples) => patch({ examples })
      }
    ) }),
    dto.endpoints.length > 0 && /* @__PURE__ */ jsx("div", { className: "mt-6", children: /* @__PURE__ */ jsx(FieldRow, { label: "Used by endpoints", align: "start", children: /* @__PURE__ */ jsx(
      "ul",
      {
        className: "rounded-md",
        style: { background: "var(--c-card)", border: "1px solid var(--c-hair)" },
        children: dto.endpoints.map((link, i) => /* @__PURE__ */ jsxs(
          "li",
          {
            className: "px-3 py-1.5 text-[12.5px] flex items-center gap-2",
            style: { borderTop: i === 0 ? "none" : "1px solid var(--c-hair)" },
            children: [
              /* @__PURE__ */ jsx(
                "span",
                {
                  className: "text-[10.5px] uppercase font-mono tracking-wider",
                  style: { color: "var(--c-subtle)", minWidth: 64 },
                  children: link.relation
                }
              ),
              /* @__PURE__ */ jsxs(
                "button",
                {
                  onClick: () => onOpenEntity?.("endpoint", link.endpointSlug),
                  className: "inline-flex items-center gap-2 hover:underline",
                  style: { color: "var(--c-accent-ink, var(--c-accent))" },
                  children: [
                    /* @__PURE__ */ jsx(MethodChip, { method: link.method }),
                    /* @__PURE__ */ jsx("span", { className: "font-mono", children: link.path })
                  ]
                }
              ),
              link.statusCode !== null && /* @__PURE__ */ jsxs(
                "span",
                {
                  className: "font-mono text-[10.5px] px-1.5 py-0.5 rounded",
                  style: { background: "var(--c-panel)", color: "var(--c-muted)" },
                  children: [
                    "@ ",
                    link.statusCode
                  ]
                }
              )
            ]
          },
          `${link.endpointSlug}-${link.relation}-${link.statusCode ?? "null"}`
        ))
      }
    ) }) }),
    /* @__PURE__ */ jsx("div", { className: "mt-6", children: /* @__PURE__ */ jsx(FieldRow, { label: "Find references", align: "start", children: refs.length === 0 ? /* @__PURE__ */ jsx("div", { className: "text-[12.5px]", style: { color: "var(--c-subtle)" }, children: "Not referenced by any page." }) : /* @__PURE__ */ jsx(
      "ul",
      {
        className: "rounded-md",
        style: { background: "var(--c-card)", border: "1px solid var(--c-hair)" },
        children: refs.map((r, i) => /* @__PURE__ */ jsxs(
          "li",
          {
            className: "px-3 py-1.5 text-[12.5px] flex items-center gap-2",
            style: { borderTop: i === 0 ? "none" : "1px solid var(--c-hair)" },
            children: [
              /* @__PURE__ */ jsx(
                "button",
                {
                  onClick: () => onOpenPage?.(r.rootId, r.pagePath),
                  className: "font-mono text-left hover:underline",
                  style: { color: "var(--c-accent-ink, var(--c-accent))" },
                  children: r.pagePath
                }
              ),
              /* @__PURE__ */ jsxs("span", { className: "text-[10.5px] font-mono", style: { color: "var(--c-subtle)" }, children: [
                ":",
                r.line
              ] }),
              /* @__PURE__ */ jsx("span", { className: "flex-1" }),
              /* @__PURE__ */ jsx("span", { className: "text-[10.5px] font-mono", style: { color: "var(--c-subtle)" }, children: r.tagType })
            ]
          },
          `${r.pagePath}:${r.line}:${i}`
        ))
      }
    ) }) })
  ] }) });
}
function ButtonGroup({ children }) {
  return /* @__PURE__ */ jsx(
    "div",
    {
      className: "flex items-center gap-0.5 p-0.5 rounded-md",
      style: { background: "var(--c-panel)", border: "1px solid var(--c-hair)" },
      children
    }
  );
}
function SegmentButton({
  icon,
  label,
  active,
  onClick,
  title,
  disabled = false
}) {
  return /* @__PURE__ */ jsxs(
    "button",
    {
      type: "button",
      onClick,
      disabled,
      "aria-pressed": active,
      title,
      className: "inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[12px] font-medium transition",
      style: {
        background: active ? "var(--c-card)" : "transparent",
        color: active ? "var(--c-accent)" : "var(--c-ink)",
        border: `1px solid ${active ? "var(--c-hair-strong)" : "transparent"}`,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1
      },
      children: [
        icon,
        label
      ]
    }
  );
}
function SegmentedControl({ options, value, onChange }) {
  return /* @__PURE__ */ jsx(ButtonGroup, { children: options.map((o) => /* @__PURE__ */ jsx(
    SegmentButton,
    {
      icon: o.icon,
      label: o.label,
      active: value === o.value,
      disabled: o.disabled,
      onClick: () => onChange(o.value),
      title: o.title ?? o.label
    },
    o.value
  )) });
}
function EntityViewSwitcher({ type, slug, view }) {
  const navigate = useNavigate();
  const prefix = clientPluginHost.getAvailable(type)?.pathPrefix ?? "";
  return /* @__PURE__ */ jsx(
    SegmentedControl,
    {
      value: view,
      onChange: (next) => navigate({
        to: next === "history" ? `${prefix}/$slug/history` : `${prefix}/$slug`,
        params: { slug }
      }),
      options: [
        { value: "details", label: "Details", icon: /* @__PURE__ */ jsx(FileText, { size: 12 }), title: "Show details" },
        { value: "history", label: "History", icon: /* @__PURE__ */ jsx(History, { size: 12 }), title: "Show version history" }
      ]
    }
  );
}
const crumbLinkClass = "inline-flex items-center gap-1.5 rounded px-1 -mx-1 transition";
function EntityBreadcrumbBar({ type, slug, method, path, name, view, hasHistory }) {
  const navigate = useNavigate();
  const getAvailable = clientPluginHost.getAvailable;
  const mod = getAvailable(type);
  const listLabel = mod?.labelPlural ?? "Entities";
  const prefix = mod?.pathPrefix ?? "";
  const crumb = renderCrumb(type, slug, method, path, name);
  return /* @__PURE__ */ jsxs(
    "div",
    {
      className: "flex items-center gap-2 px-5 py-2.5",
      style: { borderBottom: "1px solid var(--c-hair)", background: "var(--c-bg)" },
      children: [
        /* @__PURE__ */ jsxs(
          "div",
          {
            className: "flex items-center gap-1.5 text-[12px] min-w-0",
            style: { color: "var(--c-muted)" },
            children: [
              /* @__PURE__ */ jsx(
                "button",
                {
                  onClick: () => navigate({ to: prefix }),
                  className: crumbLinkClass,
                  style: { color: "var(--c-muted)" },
                  children: listLabel
                }
              ),
              /* @__PURE__ */ jsx(ChevronRight, { size: 11 }),
              /* @__PURE__ */ jsx(
                "span",
                {
                  className: "flex items-center gap-1.5",
                  style: { color: "var(--c-ink)", fontWeight: 600 },
                  children: crumb
                }
              )
            ]
          }
        ),
        /* @__PURE__ */ jsx("span", { className: "flex-1" }),
        hasHistory && /* @__PURE__ */ jsx(EntityViewSwitcher, { type, slug, view })
      ]
    }
  );
}
function renderCrumb(type, slug, method, path, name) {
  if (type === "endpoint") {
    return /* @__PURE__ */ jsxs(Fragment, { children: [
      method && /* @__PURE__ */ jsx(MethodChip, { method }),
      path && /* @__PURE__ */ jsx("span", { className: "font-mono", children: path })
    ] });
  }
  if (type === "dto") {
    return /* @__PURE__ */ jsxs(Fragment, { children: [
      /* @__PURE__ */ jsx(Braces, { size: 12, style: { color: "var(--c-accent)" } }),
      /* @__PURE__ */ jsx("span", { children: name ?? slug })
    ] });
  }
  if (type === "database-table") {
    return /* @__PURE__ */ jsxs(Fragment, { children: [
      /* @__PURE__ */ jsx(Database, { size: 12, style: { color: "var(--c-accent)" } }),
      /* @__PURE__ */ jsx("span", { className: "font-mono", children: name ?? slug })
    ] });
  }
  if (type === "ui-view") {
    return /* @__PURE__ */ jsxs(Fragment, { children: [
      /* @__PURE__ */ jsx(Monitor, { size: 12, style: { color: "var(--c-accent)" } }),
      /* @__PURE__ */ jsx("span", { children: name ?? slug })
    ] });
  }
  return /* @__PURE__ */ jsx("span", { className: "font-mono", children: slug });
}
function toList(navigate, pathPrefix) {
  navigate({ to: pathPrefix });
}
function toDetail(navigate, pathPrefix, slug, opts) {
  navigate({ to: `${pathPrefix}/$slug`, params: { slug }, ...opts });
}
function toPage(navigate, rootId, path) {
  navigate({ to: "/space/$rootId/$", params: { rootId, _splat: path } });
}
function DtoCreateDialog({ onClose, onCreated }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [formError, setFormError] = useState(null);
  const create = useCreateDto();
  async function submit() {
    if (!name.trim()) {
      setFormError("Name is required");
      return;
    }
    const tags = tagsText.split(/[, ]+/).map((s) => s.trim()).filter(Boolean);
    try {
      const dto = await create.mutateAsync({
        name: name.trim(),
        ...description.trim() ? { description: description.trim() } : {},
        ...tags.length ? { tags } : {}
      });
      onCreated(dto);
    } catch (err) {
      setFormError(err.message);
    }
  }
  return /* @__PURE__ */ jsx(
    Dialog,
    {
      open: true,
      onClose,
      size: "sm",
      title: "New DTO",
      footer: /* @__PURE__ */ jsxs(Fragment, { children: [
        /* @__PURE__ */ jsx(ActionButton, { label: "Cancel", variant: "ghost", onClick: onClose }),
        /* @__PURE__ */ jsx(
          ActionButton,
          {
            label: create.isPending ? "Creating…" : "Create",
            variant: "primary",
            disabled: create.isPending,
            onClick: () => void submit()
          }
        )
      ] }),
      children: /* @__PURE__ */ jsxs(FormShell, { error: formError, onSubmit: () => void submit(), children: [
        /* @__PURE__ */ jsx(FormField, { label: "Name (PascalCase)", children: /* @__PURE__ */ jsx(
          "input",
          {
            autoFocus: true,
            value: name,
            onChange: (e) => {
              setName(e.target.value);
              if (formError) setFormError(null);
            },
            placeholder: "UserResponse",
            style: { fontFamily: "ui-monospace, monospace" }
          }
        ) }),
        /* @__PURE__ */ jsx(FormField, { label: "Description (optional)", children: /* @__PURE__ */ jsx(
          "input",
          {
            value: description,
            onChange: (e) => setDescription(e.target.value),
            placeholder: "Returned by GET /users"
          }
        ) }),
        /* @__PURE__ */ jsx(FormField, { label: "Tags (optional)", children: /* @__PURE__ */ jsx(
          "input",
          {
            value: tagsText,
            onChange: (e) => setTagsText(e.target.value),
            placeholder: "auth, public"
          }
        ) })
      ] })
    }
  );
}
function ListPageLayout({ children }) {
  return /* @__PURE__ */ jsx("div", { className: "flex-1 flex flex-col min-h-0 overflow-hidden", children });
}
function ListPageHeader({
  icon,
  title,
  count,
  search,
  onSearchChange,
  searchPlaceholder,
  createLabel,
  onCreate
}) {
  return /* @__PURE__ */ jsx(
    EntityListHeader,
    {
      icon,
      title,
      count,
      search,
      onSearchChange,
      searchPlaceholder,
      actions: /* @__PURE__ */ jsxs(
        "button",
        {
          onClick: onCreate,
          className: "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12.5px] font-medium",
          style: { background: "var(--c-accent)", color: "#fff" },
          children: [
            /* @__PURE__ */ jsx(Plus, { size: 13 }),
            " ",
            createLabel
          ]
        }
      )
    }
  );
}
function ListScrollArea({
  loading,
  empty,
  emptyTitle,
  emptyHint,
  createLabel,
  onCreate,
  children
}) {
  return /* @__PURE__ */ jsxs(EntityListLayout, { children: [
    loading && /* @__PURE__ */ jsx(LoadingState, { lines: 5, height: 40 }),
    !loading && empty && /* @__PURE__ */ jsx(
      EmptyState,
      {
        title: emptyTitle,
        hint: emptyHint,
        action: /* @__PURE__ */ jsxs(
          "button",
          {
            onClick: onCreate,
            className: "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12.5px] font-medium mt-2",
            style: { background: "var(--c-accent)", color: "#fff" },
            children: [
              /* @__PURE__ */ jsx(Plus, { size: 13 }),
              " ",
              createLabel
            ]
          }
        )
      }
    ),
    !loading && !empty && children
  ] });
}
function CountBadge({ children }) {
  return /* @__PURE__ */ jsx(
    "span",
    {
      className: "font-mono text-[10.5px] px-1.5 py-0.5 rounded",
      style: { background: "var(--c-panel)", color: "var(--c-muted)" },
      children
    }
  );
}
function useEntityListQuery(type, opts) {
  const { search, tagFilter, onTagToggle, extraQuery } = opts;
  const [tagMode, setTagMode] = useState("or");
  const { data: tags = [] } = useTags();
  const extraKey = JSON.stringify(extraQuery ?? {});
  const query = useMemo(
    () => ({
      search: search || void 0,
      tags: tagFilter.length ? tagFilter : void 0,
      tagFilter: tagFilter.length ? tagMode : void 0,
      ...extraQuery
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [search, tagFilter, tagMode, extraKey]
  );
  const tagCatalog = tags;
  const tagLookup = useMemo(() => new Map(tagCatalog.map((t) => [t.slug, t])), [tagCatalog]);
  const tagBar = {
    tags: tagCatalog.filter((t) => (t.counts[type] ?? 0) > 0),
    tagFilter,
    onTagToggle,
    tagMode,
    onToggleMode: () => setTagMode((m) => m === "and" ? "or" : "and"),
    onClear: () => tagFilter.forEach(onTagToggle)
  };
  return { query, tags, tagLookup, tagBar };
}
function DtosList({
  search,
  tagFilter,
  onSearchChange,
  onTagToggle,
  onSelect
}) {
  const { query, tagLookup, tagBar } = useEntityListQuery("dto", { search, tagFilter, onTagToggle });
  const { data: dtos = [], isLoading } = useDtos(query);
  const [createOpen, setCreateOpen] = useState(false);
  function handleCreate() {
    setCreateOpen(true);
  }
  function handleCreated(dto) {
    setCreateOpen(false);
    onSelect(dto.slug);
    toast.success(`DTO ${dto.name} created`);
  }
  return /* @__PURE__ */ jsxs(ListPageLayout, { children: [
    /* @__PURE__ */ jsx(
      ListPageHeader,
      {
        icon: Braces,
        title: "DTOs",
        count: dtos.length,
        search,
        onSearchChange,
        searchPlaceholder: "Search name, slug, description…",
        createLabel: "New DTO",
        onCreate: handleCreate
      }
    ),
    /* @__PURE__ */ jsx(TagFilterBar, { ...tagBar }),
    /* @__PURE__ */ jsx(
      ListScrollArea,
      {
        loading: isLoading,
        empty: dtos.length === 0,
        emptyTitle: "No DTOs match your filters.",
        createLabel: "Create your first DTO",
        onCreate: handleCreate,
        children: dtos.map((d) => /* @__PURE__ */ jsxs(
          EntityListRow,
          {
            icon: Braces,
            onClick: () => onSelect(d.slug),
            tags: d.tags,
            tagLookup,
            trailing: /* @__PURE__ */ jsxs(CountBadge, { children: [
              d.fields.length,
              "f"
            ] }),
            children: [
              /* @__PURE__ */ jsx("div", { className: "flex items-center gap-2", children: /* @__PURE__ */ jsx("span", { className: "text-[14px]", style: { color: "var(--c-ink)", fontWeight: 500 }, children: d.name }) }),
              d.description && /* @__PURE__ */ jsx("div", { className: "text-[12.5px] truncate mt-0.5", style: { color: "var(--c-muted)" }, children: d.description })
            ]
          },
          d.slug
        ))
      }
    ),
    createOpen && /* @__PURE__ */ jsx(DtoCreateDialog, { onClose: () => setCreateOpen(false), onCreated: handleCreated })
  ] });
}
const Pane$1 = ({ children }) => /* @__PURE__ */ jsx("main", { style: { flex: 1, minWidth: 0, height: "100%", overflow: "auto", background: "var(--c-bg)" }, children });
function DtosIndexRoute() {
  const navigate = useNavigate();
  const search = useSearch({ strict: false });
  return /* @__PURE__ */ jsx(Pane$1, { children: /* @__PURE__ */ jsx(
    DtosList,
    {
      search: search.q ?? "",
      tagFilter: search.tag ? [search.tag] : [],
      onSearchChange: (q) => navigate({ to: DTO_PATH_PREFIX, search: (prev) => ({ ...prev, q: q || void 0 }) }),
      onTagToggle: (tag) => navigate({
        to: DTO_PATH_PREFIX,
        search: (prev) => ({ ...prev, tag: prev.tag === tag ? void 0 : tag })
      }),
      onSelect: (slug) => toDetail(navigate, DTO_PATH_PREFIX, slug)
    }
  ) });
}
function DtoDetailRoute() {
  const navigate = useNavigate();
  const { slug } = useParams({ strict: false });
  const { data: dto } = useDto(slug);
  return /* @__PURE__ */ jsxs(Pane$1, { children: [
    /* @__PURE__ */ jsx(EntityBreadcrumbBar, { type: DTO_TYPE, slug, name: dto?.name, view: "details", hasHistory: true }),
    /* @__PURE__ */ jsx(
      DtoDetail,
      {
        slug,
        onDeleted: () => toList(navigate, DTO_PATH_PREFIX),
        onRenamed: (newSlug) => toDetail(navigate, DTO_PATH_PREFIX, newSlug, { replace: true }),
        onOpenEntity: (_type, endpointSlug) => toDetail(navigate, ENDPOINT_PATH_PREFIX, endpointSlug),
        onOpenPage: (rootId, path) => toPage(navigate, rootId, path)
      },
      slug
    )
  ] });
}
function DtoHistoryRoute() {
  const { slug } = useParams({ strict: false });
  const { data: dto } = useDto(slug);
  return /* @__PURE__ */ jsxs(Pane$1, { children: [
    /* @__PURE__ */ jsx(EntityBreadcrumbBar, { type: DTO_TYPE, slug, name: dto?.name, view: "history", hasHistory: true }),
    /* @__PURE__ */ jsx(EntityVersionHistoryView, { type: DTO_TYPE, slug })
  ] });
}
const dtoRoutes = ({ rootRoute }) => {
  const make = createRoute;
  return [
    make({ getParentRoute: () => rootRoute, path: DTO_PATH_PREFIX, component: DtosIndexRoute }),
    make({ getParentRoute: () => rootRoute, path: `${DTO_PATH_PREFIX}/$slug`, component: DtoDetailRoute }),
    make({
      getParentRoute: () => rootRoute,
      path: `${DTO_PATH_PREFIX}/$slug/history`,
      component: DtoHistoryRoute
    })
  ];
};
function DtoRow({ entity, active, onOpen }) {
  return /* @__PURE__ */ jsxs(
    "button",
    {
      onClick: onOpen,
      className: "w-full text-left px-2 py-1.5 rounded-md flex items-center gap-2 transition",
      style: { background: active ? "var(--c-accent-soft)" : "transparent" },
      onMouseEnter: (e) => {
        if (!active) e.currentTarget.style.background = "var(--c-panel)";
      },
      onMouseLeave: (e) => {
        if (!active) e.currentTarget.style.background = "transparent";
      },
      children: [
        /* @__PURE__ */ jsx(Braces, { size: 14, style: { color: "var(--c-accent)" } }),
        /* @__PURE__ */ jsxs("span", { className: "flex-1 min-w-0", children: [
          /* @__PURE__ */ jsx("span", { className: "block text-[13px]", style: { color: "var(--c-ink)", fontWeight: 500 }, children: entity.name }),
          entity.description && /* @__PURE__ */ jsx("span", { className: "block text-[11.5px] truncate", style: { color: "var(--c-subtle)" }, children: entity.description })
        ] }),
        /* @__PURE__ */ jsxs(
          "span",
          {
            className: "font-mono text-[10.5px] px-1.5 py-0.5 rounded",
            style: { background: "var(--c-panel)", color: "var(--c-muted)" },
            children: [
              entity.fields.length,
              "f"
            ]
          }
        )
      ]
    }
  );
}
function DtoChip({ slug, entity, onOpen }) {
  if (!entity) {
    return /* @__PURE__ */ jsxs(
      "button",
      {
        onClick: onOpen,
        title: `broken reference: dto '${slug}'`,
        className: "inline-flex items-center gap-1 align-middle rounded px-1.5 py-[1px] text-[11px] font-mono",
        style: {
          background: "var(--c-red-soft, rgba(196,90,59,0.14))",
          color: "var(--c-red, #c45a3b)",
          border: "1px solid var(--c-red, #c45a3b)"
        },
        children: [
          "⚠ ",
          slug
        ]
      }
    );
  }
  return /* @__PURE__ */ jsxs(
    "button",
    {
      onClick: onOpen,
      className: "inline-flex items-center gap-1 align-middle rounded px-1.5 py-[1px] transition",
      style: {
        border: "1px solid var(--c-hair)",
        background: "var(--c-card)",
        fontSize: 12
      },
      onMouseEnter: (e) => e.currentTarget.style.borderColor = "var(--c-hair-strong)",
      onMouseLeave: (e) => e.currentTarget.style.borderColor = "var(--c-hair)",
      children: [
        /* @__PURE__ */ jsx(Braces, { size: 11, style: { color: "var(--c-accent)" } }),
        /* @__PURE__ */ jsx("span", { style: { color: "var(--c-ink)" }, children: entity.name })
      ]
    }
  );
}
function DtoCard({ slug, entity, onOpen }) {
  if (!entity) {
    return /* @__PURE__ */ jsx(
      "div",
      {
        className: "rounded-md p-3",
        style: {
          background: "var(--c-red-soft, rgba(196,90,59,0.08))",
          border: "1px dashed var(--c-red, #c45a3b)",
          color: "var(--c-red, #c45a3b)"
        },
        children: /* @__PURE__ */ jsxs("div", { className: "text-[12px] font-mono", children: [
          '⚠ broken: dto "',
          slug,
          '"'
        ] })
      }
    );
  }
  return /* @__PURE__ */ jsxs(
    "button",
    {
      onClick: onOpen,
      className: "w-full text-left rounded-md p-3 transition",
      style: { background: "var(--c-card)", border: "1px solid var(--c-hair)" },
      onMouseEnter: (e) => e.currentTarget.style.borderColor = "var(--c-accent)",
      onMouseLeave: (e) => e.currentTarget.style.borderColor = "var(--c-hair)",
      children: [
        /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2", children: [
          /* @__PURE__ */ jsx(Braces, { size: 14, style: { color: "var(--c-accent)" } }),
          /* @__PURE__ */ jsx("span", { className: "text-[15px]", style: { color: "var(--c-ink)", fontWeight: 600 }, children: entity.name }),
          /* @__PURE__ */ jsx("span", { className: "flex-1" }),
          /* @__PURE__ */ jsx(ChevronRight, { size: 14, style: { color: "var(--c-subtle)" } })
        ] }),
        entity.description && /* @__PURE__ */ jsx("div", { className: "mt-1.5 text-[12.5px]", style: { color: "var(--c-muted)" }, children: entity.description }),
        entity.fields.length > 0 && /* @__PURE__ */ jsxs("ul", { className: "mt-3 space-y-0.5", children: [
          entity.fields.slice(0, 6).map((f) => /* @__PURE__ */ jsxs(
            "li",
            {
              className: "font-mono text-[12px] flex items-center gap-1.5",
              style: { color: "var(--c-muted)" },
              children: [
                /* @__PURE__ */ jsx("span", { style: { color: "var(--c-ink)" }, children: f.name }),
                /* @__PURE__ */ jsx("span", { style: { color: "var(--c-subtle)" }, children: ":" }),
                /* @__PURE__ */ jsx("span", { children: f.type }),
                f.required && /* @__PURE__ */ jsx(
                  "span",
                  {
                    className: "text-[10px] px-1 rounded",
                    style: { background: "var(--c-panel)", color: "var(--c-accent-ink, var(--c-accent))" },
                    children: "req"
                  }
                )
              ]
            },
            f.name
          )),
          entity.fields.length > 6 && /* @__PURE__ */ jsxs("li", { className: "text-[11px]", style: { color: "var(--c-subtle)" }, children: [
            "… +",
            entity.fields.length - 6,
            " more"
          ] })
        ] })
      ]
    }
  );
}
const dtoFrontendModule = {
  type: "dto",
  table: "dto",
  label: "DTO",
  labelPlural: "DTOs",
  displayOrder: 20,
  pathPrefix: "/dtos",
  slugFrom: (data) => {
    const name = data.name ?? "";
    return name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  },
  renderRow: DtoRow,
  renderChip: DtoChip,
  renderCard: DtoCard,
  detailPanel: DtoDetail,
  useGetBySlug: (slug) => useDto(slug),
  listByTags: ({ tags, filter }) => dtosApi.list({ tags, tagFilter: filter }),
  routes: dtoRoutes,
  editorExtensions: [
    {
      name: "dto-slash",
      slashCommand: {
        id: "dto",
        label: "/dto",
        description: "Create a new DTO inline",
        hint: "name"
      }
    }
  ],
  sidebarTab: { icon: Braces, label: "DTOs", order: 20 }
};
const endpointsApi = {
  async list(query = {}) {
    const params = new URLSearchParams();
    if (query.search) params.set("search", query.search);
    if (query.tags?.length) params.set("tags", query.tags.join(","));
    if (query.tagFilter) params.set("tagFilter", query.tagFilter);
    if (query.limit) params.set("limit", String(query.limit));
    if (query.offset) params.set("offset", String(query.offset));
    const q = params.toString() ? `?${params.toString()}` : "";
    const data = await handle(await apiFetch(`/api/endpoints${q}`));
    return data.endpoints;
  },
  async get(slug) {
    return handle(await apiFetch(`/api/endpoints/${encodeURIComponent(slug)}`));
  },
  async create(input) {
    return handle(
      await apiFetch("/api/endpoints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input)
      })
    );
  },
  async update(slug, input) {
    return handle(
      await apiFetch(`/api/endpoints/${encodeURIComponent(slug)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input)
      })
    );
  },
  async remove(slug) {
    return handle(
      await apiFetch(`/api/endpoints/${encodeURIComponent(slug)}`, { method: "DELETE" })
    );
  },
  async linkDto(slug, dtoSlug, relation, statusCode = null) {
    return handle(
      await apiFetch(`/api/endpoints/${encodeURIComponent(slug)}/dtos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dtoSlug, relation, statusCode })
      })
    );
  },
  async unlinkDto(slug, dtoSlug, relation, statusCode = null) {
    const url = new URL(
      `/api/endpoints/${encodeURIComponent(slug)}/dtos/${encodeURIComponent(dtoSlug)}/${relation}`,
      window.location.origin
    );
    if (statusCode !== null) url.searchParams.set("statusCode", String(statusCode));
    return handle(await apiFetch(url.pathname + url.search, { method: "DELETE" }));
  }
};
const keys = {
  all: ["endpoints"],
  list: (q) => ["endpoints", "list", q],
  detail: (slug) => ["endpoint", slug]
};
function useEndpoints(query = {}) {
  return useQuery({
    queryKey: keys.list(query),
    queryFn: () => endpointsApi.list(query)
  });
}
function useEndpoint(slug) {
  return useQuery({
    queryKey: slug ? keys.detail(slug) : ["endpoint", "none"],
    queryFn: () => endpointsApi.get(slug),
    enabled: Boolean(slug)
  });
}
function useCreateEndpoint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input) => endpointsApi.create(input),
    onSuccess: (ep) => {
      qc.invalidateQueries({ queryKey: keys.all });
      qc.setQueryData(keys.detail(ep.slug), ep);
    }
  });
}
function useUpdateEndpoint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, input }) => endpointsApi.update(slug, input),
    onSuccess: (ep, { slug }) => {
      qc.invalidateQueries({ queryKey: keys.all });
      if (slug !== ep.slug) qc.removeQueries({ queryKey: keys.detail(slug) });
      qc.setQueryData(keys.detail(ep.slug), ep);
      qc.invalidateQueries({ queryKey: ["versions", "endpoint", ep.slug] });
      qc.invalidateQueries({ queryKey: ["tags"] });
    }
  });
}
function useLinkDto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      slug,
      dtoSlug,
      relation,
      statusCode
    }) => endpointsApi.linkDto(slug, dtoSlug, relation, statusCode ?? null),
    onSuccess: (ep) => {
      qc.setQueryData(keys.detail(ep.slug), ep);
      qc.invalidateQueries({ queryKey: keys.all });
      qc.invalidateQueries({ queryKey: ["dtos"] });
      for (const link of ep.dtos) qc.invalidateQueries({ queryKey: ["dto", link.dtoSlug] });
    }
  });
}
function useUnlinkDto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      slug,
      dtoSlug,
      relation,
      statusCode
    }) => endpointsApi.unlinkDto(slug, dtoSlug, relation, statusCode ?? null),
    onSuccess: (ep, vars) => {
      qc.setQueryData(keys.detail(ep.slug), ep);
      qc.invalidateQueries({ queryKey: keys.all });
      qc.invalidateQueries({ queryKey: ["dtos"] });
      qc.invalidateQueries({ queryKey: ["dto", vars.dtoSlug] });
    }
  });
}
function useDeleteEndpoint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (slug) => endpointsApi.remove(slug),
    onSuccess: (_data, slug) => {
      qc.invalidateQueries({ queryKey: keys.all });
      qc.removeQueries({ queryKey: keys.detail(slug) });
      qc.invalidateQueries({ queryKey: ["tags"] });
    }
  });
}
const METHODS$1 = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const RELATIONS = ["request", "response", "error"];
function toDraft(e) {
  return {
    method: e.method,
    path: e.path,
    summary: e.summary ?? "",
    description: e.description ?? "",
    tags: e.tags
  };
}
function EndpointDetail({
  slug,
  onDeleted,
  onRenamed,
  onOpenEntity,
  onOpenPage
}) {
  const { data: endpoint, isLoading, error } = useEndpoint(slug);
  const update = useUpdateEndpoint();
  const remove = useDeleteEndpoint();
  const linkDto = useLinkDto();
  const unlinkDto = useUnlinkDto();
  const { data: allTags = [] } = useTags();
  const { data: allDtos = [] } = useDtos();
  const { data: refs = [] } = useReferences("endpoint", endpoint?.slug ?? null);
  const { draft, dirty, patch } = useEntityDraftEditor({
    entity: endpoint,
    toDraft,
    save: async (current, ep) => {
      const updated = await update.mutateAsync({
        slug: ep.slug,
        input: {
          method: current.method,
          path: current.path,
          summary: current.summary,
          description: current.description || null,
          tags: current.tags
        }
      });
      if (updated.slug !== ep.slug) onRenamed(updated.slug);
      return updated;
    }
  });
  async function handleDelete() {
    if (!endpoint) return;
    const ok = await confirmDestructive({
      title: "Delete endpoint?",
      body: `Delete ${endpoint.method} ${endpoint.path}? All references to this endpoint will become broken.`,
      confirmLabel: "Delete"
    });
    if (!ok) return;
    try {
      await remove.mutateAsync(endpoint.slug);
      onDeleted();
      toast.success(`Endpoint ${endpoint.method} ${endpoint.path} deleted`);
    } catch (err) {
      toast.error(err.message);
    }
  }
  function toggleTag(tagSlug2) {
    if (!draft) return;
    const next = draft.tags.includes(tagSlug2) ? draft.tags.filter((t) => t !== tagSlug2) : [...draft.tags, tagSlug2];
    patch({ tags: next });
  }
  function handleCreateTag(name) {
    if (!draft) return;
    const slug2 = tagSlug(name);
    if (!slug2 || draft.tags.includes(slug2)) return;
    patch({ tags: [...draft.tags, slug2] });
  }
  if (isLoading && !endpoint) {
    return /* @__PURE__ */ jsx("div", { className: "p-8 text-[13px]", style: { color: "var(--c-subtle)" }, children: "Loading endpoint…" });
  }
  if (error) {
    return /* @__PURE__ */ jsxs("div", { className: "p-8 text-[13px]", style: { color: "var(--c-red)" }, children: [
      "Failed to load: ",
      error.message
    ] });
  }
  if (!endpoint || !draft) return null;
  return /* @__PURE__ */ jsx("div", { className: "flex-1 overflow-auto nice-scroll", children: /* @__PURE__ */ jsxs(FieldGrid, { maxWidth: 740, children: [
    /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2 mb-1 text-[11px]", style: { color: "var(--c-subtle)" }, children: [
      /* @__PURE__ */ jsx("span", { className: "font-mono", children: endpoint.slug }),
      /* @__PURE__ */ jsx("span", { children: "·" }),
      /* @__PURE__ */ jsxs("span", { children: [
        "updated",
        " ",
        (/* @__PURE__ */ new Date(endpoint.updatedAt.replace(" ", "T") + "Z")).toLocaleString(void 0, {
          dateStyle: "medium",
          timeStyle: "short"
        })
      ] }),
      update.isPending && /* @__PURE__ */ jsx("span", { style: { color: "var(--c-accent-ink, var(--c-accent))" }, children: "saving…" }),
      !update.isPending && dirty && /* @__PURE__ */ jsx("span", { style: { color: "var(--c-accent-ink, var(--c-accent))" }, children: "edited" }),
      /* @__PURE__ */ jsx("span", { className: "flex-1" }),
      /* @__PURE__ */ jsxs(
        "button",
        {
          onClick: handleDelete,
          className: "inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px]",
          style: { color: "var(--c-red, #c45a3b)" },
          title: "Delete",
          children: [
            /* @__PURE__ */ jsx(Trash, { size: 11 }),
            " Delete"
          ]
        }
      )
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2 mt-2 mb-1", children: [
      /* @__PURE__ */ jsx(
        EnumBadgePicker,
        {
          options: METHODS$1.map((m) => ({ value: m, label: METHOD_STYLE[m].label, color: METHOD_STYLE[m].fg })),
          value: draft.method,
          onChange: (m) => patch({ method: m })
        }
      ),
      /* @__PURE__ */ jsx(
        "input",
        {
          value: draft.path,
          onChange: (e) => patch({ path: e.target.value }),
          className: "flex-1 bg-transparent outline-none font-mono",
          style: {
            fontSize: 28,
            color: "var(--c-ink)",
            fontWeight: 600
          },
          placeholder: "/api/...",
          spellCheck: false
        }
      )
    ] }),
    /* @__PURE__ */ jsx(
      "input",
      {
        value: draft.summary,
        onChange: (e) => patch({ summary: e.target.value }),
        className: "w-full bg-transparent outline-none text-[15px] mt-1",
        style: { color: "var(--c-muted)" },
        placeholder: "Short summary…"
      }
    ),
    /* @__PURE__ */ jsx(FieldRow, { label: "Tags", children: /* @__PURE__ */ jsx(
      TagPicker,
      {
        allTags,
        selected: draft.tags,
        onToggle: toggleTag,
        onCreate: handleCreateTag,
        variant: "collapsed"
      }
    ) }),
    /* @__PURE__ */ jsx("div", { className: "mt-6", children: /* @__PURE__ */ jsx(FieldRow, { label: "Description", align: "start", children: /* @__PURE__ */ jsx(
      DocEditor,
      {
        value: draft.description,
        onChange: (md) => patch({ description: md }),
        placeholder: "Describe what this endpoint does, invariants, gotchas…"
      }
    ) }) }),
    /* @__PURE__ */ jsx("div", { className: "mt-6", children: /* @__PURE__ */ jsx(FieldRow, { label: "Linked DTOs", align: "start", children: /* @__PURE__ */ jsx(
      GroupedRelationPicker,
      {
        groups: RELATIONS.map((rel) => ({
          key: rel,
          label: rel,
          items: allDtos.map((d) => {
            const link = endpoint.dtos.find((l) => l.dtoSlug === d.slug && l.relation === rel);
            return {
              id: d.slug,
              label: d.name,
              badge: rel === "request" ? void 0 : /* @__PURE__ */ jsx(
                StatusBadge,
                {
                  value: link?.statusCode ?? (rel === "response" ? 200 : 400),
                  onChange: (status) => {
                    if (link) unlinkDto.mutate({ slug: endpoint.slug, dtoSlug: d.slug, relation: rel, statusCode: link.statusCode });
                    linkDto.mutate({ slug: endpoint.slug, dtoSlug: d.slug, relation: rel, statusCode: status });
                  }
                }
              )
            };
          })
        })),
        selected: RELATIONS.reduce((acc, rel) => {
          acc[rel] = endpoint.dtos.filter((l) => l.relation === rel).map((l) => l.dtoSlug);
          return acc;
        }, {}),
        onAdd: (rel, dtoSlug) => {
          const relation = rel;
          const status = relation === "response" ? 200 : relation === "error" ? 400 : null;
          linkDto.mutate({ slug: endpoint.slug, dtoSlug, relation, statusCode: status });
        },
        onRemove: (rel, dtoSlug) => {
          const relation = rel;
          const link = endpoint.dtos.find((l) => l.dtoSlug === dtoSlug && l.relation === relation);
          unlinkDto.mutate({ slug: endpoint.slug, dtoSlug, relation, statusCode: link?.statusCode ?? null });
        }
      }
    ) }) }),
    /* @__PURE__ */ jsx("div", { className: "mt-6", children: /* @__PURE__ */ jsx(FieldRow, { label: "Find references", align: "start", children: refs.length === 0 ? /* @__PURE__ */ jsx("div", { className: "text-[12.5px]", style: { color: "var(--c-subtle)" }, children: "Not referenced by any page." }) : /* @__PURE__ */ jsx(
      "ul",
      {
        className: "rounded-md",
        style: { background: "var(--c-card)", border: "1px solid var(--c-hair)" },
        children: refs.map((r, i) => /* @__PURE__ */ jsxs(
          "li",
          {
            className: "px-3 py-1.5 text-[12.5px] flex items-center gap-2",
            style: { borderTop: i === 0 ? "none" : "1px solid var(--c-hair)" },
            children: [
              /* @__PURE__ */ jsx(
                "button",
                {
                  onClick: () => onOpenPage?.(r.rootId, r.pagePath),
                  className: "font-mono text-left hover:underline",
                  style: { color: "var(--c-accent-ink, var(--c-accent))" },
                  children: r.pagePath
                }
              ),
              /* @__PURE__ */ jsxs("span", { className: "text-[10.5px] font-mono", style: { color: "var(--c-subtle)" }, children: [
                ":",
                r.line
              ] }),
              /* @__PURE__ */ jsx("span", { className: "flex-1" }),
              /* @__PURE__ */ jsx("span", { className: "text-[10.5px] font-mono", style: { color: "var(--c-subtle)" }, children: r.tagType })
            ]
          },
          `${r.pagePath}:${r.line}:${i}`
        ))
      }
    ) }) })
  ] }) });
}
function StatusBadge({ value, onChange }) {
  const [draft, setDraft] = useState(value === null ? "" : String(value));
  useEffect(() => setDraft(value === null ? "" : String(value)), [value]);
  return /* @__PURE__ */ jsx(
    "input",
    {
      value: draft,
      onChange: (e) => setDraft(e.target.value.replace(/[^0-9]/g, "")),
      onBlur: () => {
        const n = draft.trim() === "" ? null : Number(draft);
        if (n !== value) onChange(Number.isInteger(n) ? n : null);
      },
      "aria-label": "status code",
      className: "font-mono text-[10.5px] px-1 rounded outline-none",
      style: { width: 34, background: "var(--c-card)", color: "var(--c-muted)", border: "none" }
    }
  );
}
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
function livePreviewSlug(method, path) {
  const base = `${method.toLowerCase()}-${path.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`;
  return base.replace(/^-+|-+$/g, "");
}
function EndpointCreateDialog({ onClose, onCreated }) {
  const [method, setMethod] = useState("POST");
  const [path, setPath] = useState("/api/");
  const [summary, setSummary] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [formError, setFormError] = useState(null);
  const create = useCreateEndpoint();
  const slug = livePreviewSlug(method, path);
  async function submit() {
    const tagList = tagsText.split(/[, ]+/).map((s) => s.trim()).filter(Boolean);
    try {
      const ep = await create.mutateAsync({
        method,
        path,
        summary: summary || void 0,
        tags: tagList.length ? tagList : void 0
      });
      onCreated(ep.slug);
      toast.success(`Endpoint ${ep.method} ${ep.path} created`);
    } catch (err) {
      setFormError(err.message || "Failed to create endpoint");
    }
  }
  function handleSubmit(e) {
    e.preventDefault();
    void submit();
  }
  return /* @__PURE__ */ jsx(
    Dialog,
    {
      open: true,
      onClose,
      size: "sm",
      title: /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-1.5 min-w-0", children: [
        /* @__PURE__ */ jsx("span", { children: "New endpoint" }),
        /* @__PURE__ */ jsx("span", { className: "flex-1" }),
        /* @__PURE__ */ jsx("span", { className: "font-mono text-[11px] font-normal", style: { color: "var(--c-muted)" }, children: "slug:" }),
        /* @__PURE__ */ jsx("span", { className: "font-mono text-[11px] font-normal truncate", style: { color: "var(--c-ink)" }, children: slug || "—" })
      ] }),
      children: /* @__PURE__ */ jsxs(
        FormShell,
        {
          onSubmit: handleSubmit,
          busy: create.isPending,
          error: formError,
          actions: /* @__PURE__ */ jsxs(Fragment, { children: [
            /* @__PURE__ */ jsx(
              ActionButton,
              {
                variant: "ghost",
                label: "Cancel",
                onClick: onClose,
                disabled: create.isPending
              }
            ),
            /* @__PURE__ */ jsx(
              ActionButton,
              {
                type: "submit",
                variant: "primary",
                label: create.isPending ? "Creating…" : "Create",
                disabled: !path || create.isPending
              }
            )
          ] }),
          children: [
            /* @__PURE__ */ jsxs(FormField, { label: "Method & path", children: [
              /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-1.5", children: [
                /* @__PURE__ */ jsx(
                  "div",
                  {
                    className: "flex items-center rounded-md overflow-hidden",
                    style: { border: "1px solid var(--c-hair-strong)" },
                    children: METHODS.map((m) => /* @__PURE__ */ jsx(
                      "button",
                      {
                        type: "button",
                        onClick: () => setMethod(m),
                        className: "px-2 py-1 text-[11px] font-mono font-semibold",
                        style: {
                          background: method === m ? METHOD_STYLE[m].bg : "transparent",
                          color: method === m ? METHOD_STYLE[m].fg : "var(--c-muted)"
                        },
                        children: METHOD_STYLE[m].label
                      },
                      m
                    ))
                  }
                ),
                /* @__PURE__ */ jsx(
                  "input",
                  {
                    value: path,
                    onChange: (e) => setPath(e.target.value),
                    autoFocus: true,
                    className: "flex-1 rounded-md px-2 py-1 text-[12.5px] font-mono outline-none",
                    style: {
                      background: "var(--c-panel)",
                      border: "1px solid var(--c-hair)",
                      color: "var(--c-ink)"
                    },
                    placeholder: "/api/..."
                  }
                )
              ] }),
              /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-1.5 text-[12px] mt-1.5", style: { color: "var(--c-muted)" }, children: [
                /* @__PURE__ */ jsx(MethodChip, { method }),
                /* @__PURE__ */ jsx("span", { className: "font-mono", children: path })
              ] })
            ] }),
            /* @__PURE__ */ jsx(FormField, { label: "Summary", children: /* @__PURE__ */ jsx(
              "input",
              {
                value: summary,
                onChange: (e) => setSummary(e.target.value),
                className: "w-full rounded-md px-2 py-1 text-[12.5px] outline-none",
                style: {
                  background: "var(--c-panel)",
                  border: "1px solid var(--c-hair)",
                  color: "var(--c-ink)"
                },
                placeholder: "Short summary"
              }
            ) }),
            /* @__PURE__ */ jsx(FormField, { label: "Tags", children: /* @__PURE__ */ jsx(
              "input",
              {
                value: tagsText,
                onChange: (e) => setTagsText(e.target.value),
                className: "w-full rounded-md px-2 py-1 text-[12.5px] outline-none font-mono",
                style: {
                  background: "var(--c-panel)",
                  border: "1px solid var(--c-hair)",
                  color: "var(--c-ink)"
                },
                placeholder: "tags (comma separated, auto-created)"
              }
            ) })
          ]
        }
      )
    }
  );
}
function EndpointsList({
  search,
  tagFilter,
  onSearchChange,
  onTagToggle,
  onSelect
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { query, tagLookup, tagBar } = useEntityListQuery("endpoint", {
    search,
    tagFilter,
    onTagToggle
  });
  const { data: endpoints = [], isLoading } = useEndpoints(query);
  return /* @__PURE__ */ jsxs(ListPageLayout, { children: [
    /* @__PURE__ */ jsx(
      ListPageHeader,
      {
        icon: ArrowRightLeft,
        title: "Endpoints",
        count: endpoints.length,
        search,
        onSearchChange,
        searchPlaceholder: "Search path, summary, slug…",
        createLabel: "New endpoint",
        onCreate: () => setDialogOpen(true)
      }
    ),
    /* @__PURE__ */ jsx(TagFilterBar, { ...tagBar }),
    /* @__PURE__ */ jsx(
      ListScrollArea,
      {
        loading: isLoading,
        empty: endpoints.length === 0,
        emptyTitle: "No endpoints match your filters.",
        createLabel: "Create your first endpoint",
        onCreate: () => setDialogOpen(true),
        children: endpoints.map((ep) => /* @__PURE__ */ jsxs(
          EntityListRow,
          {
            leading: /* @__PURE__ */ jsx(MethodChip, { method: ep.method, large: true }),
            onClick: () => onSelect(ep.slug),
            tags: ep.tags,
            tagLookup,
            trailing: /* @__PURE__ */ jsx("span", { className: "font-mono text-[10.5px]", style: { color: "var(--c-subtle)" }, children: ep.slug }),
            children: [
              /* @__PURE__ */ jsx("div", { className: "flex items-center gap-2", children: /* @__PURE__ */ jsx(
                "span",
                {
                  className: "font-mono text-[13.5px]",
                  style: { color: "var(--c-ink)", fontWeight: 500 },
                  children: ep.path
                }
              ) }),
              /* @__PURE__ */ jsx("div", { className: "text-[12.5px] truncate mt-0.5", style: { color: "var(--c-muted)" }, children: ep.summary || /* @__PURE__ */ jsx("span", { style: { color: "var(--c-subtle)" }, children: "— no summary —" }) })
            ]
          },
          ep.slug
        ))
      }
    ),
    dialogOpen && /* @__PURE__ */ jsx(
      EndpointCreateDialog,
      {
        onClose: () => setDialogOpen(false),
        onCreated: (slug) => {
          setDialogOpen(false);
          onSelect(slug);
        }
      }
    )
  ] });
}
const Pane = ({ children }) => /* @__PURE__ */ jsx("main", { style: { flex: 1, minWidth: 0, height: "100%", overflow: "auto", background: "var(--c-bg)" }, children });
function EndpointsIndexRoute() {
  const navigate = useNavigate();
  const search = useSearch({ strict: false });
  return /* @__PURE__ */ jsx(Pane, { children: /* @__PURE__ */ jsx(
    EndpointsList,
    {
      search: search.q ?? "",
      tagFilter: search.tag ? [search.tag] : [],
      onSearchChange: (q) => navigate({
        to: ENDPOINT_PATH_PREFIX,
        search: (prev) => ({ ...prev, q: q || void 0 })
      }),
      onTagToggle: (tag) => navigate({
        to: ENDPOINT_PATH_PREFIX,
        search: (prev) => ({ ...prev, tag: prev.tag === tag ? void 0 : tag })
      }),
      onSelect: (slug) => toDetail(navigate, ENDPOINT_PATH_PREFIX, slug)
    }
  ) });
}
function EndpointDetailRoute() {
  const navigate = useNavigate();
  const { slug } = useParams({ strict: false });
  const { data: endpoint } = useEndpoint(slug);
  return /* @__PURE__ */ jsxs(Pane, { children: [
    /* @__PURE__ */ jsx(
      EntityBreadcrumbBar,
      {
        type: ENDPOINT_TYPE,
        slug,
        method: endpoint?.method,
        path: endpoint?.path,
        view: "details",
        hasHistory: true
      }
    ),
    /* @__PURE__ */ jsx(
      EndpointDetail,
      {
        slug,
        onDeleted: () => toList(navigate, ENDPOINT_PATH_PREFIX),
        onRenamed: (newSlug) => toDetail(navigate, ENDPOINT_PATH_PREFIX, newSlug, { replace: true }),
        onOpenPage: (rootId, path) => toPage(navigate, rootId, path)
      },
      slug
    )
  ] });
}
function EndpointHistoryRoute() {
  const { slug } = useParams({ strict: false });
  const { data: endpoint } = useEndpoint(slug);
  return /* @__PURE__ */ jsxs(Pane, { children: [
    /* @__PURE__ */ jsx(
      EntityBreadcrumbBar,
      {
        type: ENDPOINT_TYPE,
        slug,
        method: endpoint?.method,
        path: endpoint?.path,
        view: "history",
        hasHistory: true
      }
    ),
    /* @__PURE__ */ jsx(EntityVersionHistoryView, { type: ENDPOINT_TYPE, slug })
  ] });
}
const endpointRoutes = ({ rootRoute }) => {
  const make = createRoute;
  return [
    make({ getParentRoute: () => rootRoute, path: ENDPOINT_PATH_PREFIX, component: EndpointsIndexRoute }),
    make({
      getParentRoute: () => rootRoute,
      path: `${ENDPOINT_PATH_PREFIX}/$slug`,
      component: EndpointDetailRoute
    }),
    make({
      getParentRoute: () => rootRoute,
      path: `${ENDPOINT_PATH_PREFIX}/$slug/history`,
      component: EndpointHistoryRoute
    })
  ];
};
function EndpointRow({ entity, active, onOpen }) {
  return /* @__PURE__ */ jsxs(
    "button",
    {
      onClick: onOpen,
      className: "w-full text-left px-2 py-1.5 rounded-md flex items-center gap-2 transition",
      style: { background: active ? "var(--c-accent-soft)" : "transparent" },
      onMouseEnter: (e) => {
        if (!active) e.currentTarget.style.background = "var(--c-panel)";
      },
      onMouseLeave: (e) => {
        if (!active) e.currentTarget.style.background = "transparent";
      },
      children: [
        /* @__PURE__ */ jsx(MethodChip, { method: entity.method }),
        /* @__PURE__ */ jsxs("span", { className: "flex-1 min-w-0", children: [
          /* @__PURE__ */ jsx(
            "span",
            {
              className: "block font-mono text-[12.5px] truncate",
              style: { color: "var(--c-ink)" },
              children: entity.path
            }
          ),
          entity.summary && /* @__PURE__ */ jsx("span", { className: "block text-[11.5px] truncate", style: { color: "var(--c-subtle)" }, children: entity.summary })
        ] })
      ]
    }
  );
}
function EndpointChip({ slug, entity, onOpen }) {
  if (!entity) {
    return /* @__PURE__ */ jsxs(
      "button",
      {
        onClick: onOpen,
        title: `broken reference: endpoint '${slug}'`,
        className: "inline-flex items-center gap-1 align-middle rounded px-1.5 py-[1px] text-[11px] font-mono",
        style: {
          background: "var(--c-red-soft, rgba(196,90,59,0.14))",
          color: "var(--c-red, #c45a3b)",
          border: "1px solid var(--c-red, #c45a3b)"
        },
        children: [
          "⚠ ",
          slug
        ]
      }
    );
  }
  return /* @__PURE__ */ jsxs(
    "button",
    {
      onClick: onOpen,
      className: "inline-flex items-center gap-1 align-middle rounded px-1 py-[1px] transition",
      style: { border: "1px solid var(--c-hair)", background: "var(--c-card)" },
      onMouseEnter: (e) => e.currentTarget.style.borderColor = "var(--c-hair-strong)",
      onMouseLeave: (e) => e.currentTarget.style.borderColor = "var(--c-hair)",
      children: [
        /* @__PURE__ */ jsx(MethodChip, { method: entity.method }),
        /* @__PURE__ */ jsx("span", { className: "font-mono text-[12px]", style: { color: "var(--c-ink)" }, children: entity.path })
      ]
    }
  );
}
function EndpointCard({ slug, entity, onOpen }) {
  if (!entity) {
    return /* @__PURE__ */ jsxs(
      "div",
      {
        className: "rounded-md p-3",
        style: {
          background: "var(--c-red-soft, rgba(196,90,59,0.08))",
          border: "1px dashed var(--c-red, #c45a3b)",
          color: "var(--c-red, #c45a3b)"
        },
        children: [
          /* @__PURE__ */ jsxs("div", { className: "text-[12px] font-mono", children: [
            '⚠ broken: endpoint "',
            slug,
            '"'
          ] }),
          /* @__PURE__ */ jsx("div", { className: "text-[11.5px] mt-1", style: { opacity: 0.8 }, children: "entity not found — use agent or sidebar to create it" })
        ]
      }
    );
  }
  return /* @__PURE__ */ jsxs(
    "button",
    {
      onClick: onOpen,
      className: "w-full text-left rounded-md p-3 transition",
      style: { background: "var(--c-card)", border: "1px solid var(--c-hair)" },
      onMouseEnter: (e) => e.currentTarget.style.borderColor = "var(--c-accent)",
      onMouseLeave: (e) => e.currentTarget.style.borderColor = "var(--c-hair)",
      children: [
        /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2", children: [
          /* @__PURE__ */ jsx(MethodChip, { method: entity.method, large: true }),
          /* @__PURE__ */ jsx("span", { className: "font-mono text-[14px]", style: { color: "var(--c-ink)", fontWeight: 600 }, children: entity.path }),
          /* @__PURE__ */ jsx("span", { className: "flex-1" }),
          /* @__PURE__ */ jsx(ChevronRight, { size: 14, style: { color: "var(--c-subtle)" } })
        ] }),
        entity.summary && /* @__PURE__ */ jsx("div", { className: "mt-1.5 text-[13px]", style: { color: "var(--c-muted)" }, children: entity.summary }),
        entity.description && /* @__PURE__ */ jsx("div", { className: "mt-1 text-[12.5px]", style: { color: "var(--c-subtle)" }, children: entity.description }),
        entity.tags.length > 0 && /* @__PURE__ */ jsx("div", { className: "mt-2 flex items-center gap-1 flex-wrap", children: entity.tags.map((t) => /* @__PURE__ */ jsx(
          "span",
          {
            className: "text-[10.5px] px-1.5 py-0.5 rounded",
            style: { background: "var(--c-panel)", color: "var(--c-muted)" },
            children: t
          },
          t
        )) })
      ]
    }
  );
}
const endpointFrontendModule = {
  type: "endpoint",
  table: "endpoint",
  label: "Endpoint",
  labelPlural: "Endpoints",
  displayOrder: 10,
  pathPrefix: "/endpoints",
  slugFrom: (data) => {
    const d = data;
    const method = (d.method ?? "GET").toLowerCase();
    const path = (d.path ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return `${method}-${path}`.replace(/^-+|-+$/g, "");
  },
  renderRow: EndpointRow,
  renderChip: EndpointChip,
  renderCard: EndpointCard,
  detailPanel: EndpointDetail,
  useGetBySlug: (slug) => useEndpoint(slug),
  listByTags: ({ tags, filter }) => endpointsApi.list({ tags, tagFilter: filter }),
  routes: endpointRoutes,
  editorExtensions: [
    {
      name: "endpoint-slash",
      slashCommand: {
        id: "endpoint",
        label: "/endpoint",
        description: "Create a new endpoint inline",
        hint: "METHOD /path"
      }
    }
  ],
  sidebarTab: { icon: ArrowRightLeft, label: "Endpoints", order: 10 }
};
function FieldLabel({ children }) {
  return /* @__PURE__ */ jsx(
    "div",
    {
      className: "text-[10.5px] uppercase tracking-wider font-mono mb-1",
      style: { color: "var(--c-subtle)" },
      children
    }
  );
}
const TextInput = forwardRef(
  function TextInput2({ style, className, ...rest }, ref) {
    return /* @__PURE__ */ jsx(
      "input",
      {
        ...rest,
        ref,
        spellCheck: false,
        className: `w-full text-[13.5px] bg-transparent outline-none px-2 py-1 rounded ${className ?? ""}`,
        style: {
          color: "var(--c-ink)",
          border: "1px solid var(--c-hair)",
          ...style
        }
      }
    );
  }
);
const SelectInput = forwardRef(function SelectInput2({ style, className, children, ...rest }, ref) {
  return /* @__PURE__ */ jsx(
    "select",
    {
      ...rest,
      ref,
      className: `w-full text-[13px] bg-transparent outline-none px-2 py-1 rounded ${className ?? ""}`,
      style: {
        color: "var(--c-ink)",
        border: "1px solid var(--c-hair)",
        ...style
      },
      children
    }
  );
});
function InlineError({ message }) {
  if (!message) return null;
  return /* @__PURE__ */ jsx("div", { className: "text-[11.5px] mt-1", style: { color: "var(--c-red, #c45a3b)" }, children: message });
}
function PopoverFooter({
  onCancel,
  onSubmit,
  submitLabel = "Create",
  busy = false,
  disabled = false,
  onRemove,
  removeLabel = "Remove"
}) {
  return /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2 justify-end mt-3", children: [
    onRemove && /* @__PURE__ */ jsx(
      "button",
      {
        onClick: onRemove,
        className: "text-[12px] px-2 py-1 rounded mr-auto",
        style: { color: "var(--c-red, #c45a3b)" },
        children: removeLabel
      }
    ),
    /* @__PURE__ */ jsx(
      "button",
      {
        onClick: onCancel,
        className: "text-[12px] px-2 py-1 rounded",
        style: { color: "var(--c-muted)" },
        children: "Cancel"
      }
    ),
    /* @__PURE__ */ jsx(
      "button",
      {
        onClick: onSubmit,
        disabled: busy || disabled,
        className: "text-[12px] px-3 py-1 rounded font-medium",
        style: {
          background: "var(--c-accent)",
          color: "#fff",
          opacity: busy || disabled ? 0.55 : 1
        },
        children: busy ? "…" : submitLabel
      }
    )
  ] });
}
const PLUGIN_COMMAND_EVENT = "c4s:plugin-command";
const EMBED_NODE = "single_element";
function insertEmbed(editor, type, slug) {
  editor.chain().focus().insertContent({ type: EMBED_NODE, attrs: { type, slug } }).run();
}
function subscribeToSlashCreate(kind, onInvoke) {
  if (typeof window === "undefined") return () => void 0;
  const handler = (ev) => {
    const detail = ev.detail;
    if (detail?.popoverKind !== kind || !detail.editor) return;
    onInvoke(detail.editor);
  };
  window.addEventListener(PLUGIN_COMMAND_EVENT, handler);
  return () => window.removeEventListener(PLUGIN_COMMAND_EVENT, handler);
}
const SHELL_STYLE = {
  position: "fixed",
  zIndex: 1200,
  padding: 10,
  borderRadius: 8,
  border: "1px solid var(--c-hair)",
  background: "var(--c-panel)",
  color: "var(--c-ink)",
  boxShadow: "0 8px 24px rgba(0,0,0,0.18)"
};
function SlashPopoverShell({
  width,
  title,
  icon,
  onCancel,
  children
}) {
  const ref = useRef(null);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onCancel();
    };
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onCancel();
    };
    window.addEventListener("keydown", onKey);
    const t = window.setTimeout(() => window.addEventListener("mousedown", onDown), 0);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [onCancel]);
  return /* @__PURE__ */ jsxs(
    "div",
    {
      ref,
      role: "dialog",
      "aria-label": title,
      style: { ...SHELL_STYLE, width, left: "50%", top: 120, transform: "translateX(-50%)" },
      children: [
        /* @__PURE__ */ jsxs(
          "div",
          {
            className: "flex items-center gap-1.5 mb-2 text-[11px] uppercase tracking-wider font-mono",
            style: { color: "var(--c-subtle)" },
            children: [
              icon,
              title
            ]
          }
        ),
        children
      ]
    }
  );
}
function mountSlashCreatePopover(kind, Component) {
  if (typeof window === "undefined" || typeof document === "undefined") return () => void 0;
  let host = null;
  let root = null;
  const close = () => root?.render(null);
  const unsubscribe = subscribeToSlashCreate(kind, (editor) => {
    void (async () => {
      const [{ createRoot }, runtime, { QueryClientProvider }, { createElement }] = await Promise.all([
        import("react-dom/client"),
        import("@c4s/plugin-runtime"),
        import("@tanstack/react-query"),
        import("react")
      ]);
      if (!host) {
        host = document.createElement("div");
        host.dataset.plugin = kind;
        document.body.appendChild(host);
      }
      root ??= createRoot(host);
      root.render(
        createElement(
          QueryClientProvider,
          { client: runtime.queryClient },
          createElement(Component, { editor, onClose: close })
        )
      );
    })();
  });
  return () => {
    unsubscribe();
    root?.unmount();
    host?.remove();
  };
}
function useSlashSubmit(run) {
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (busy) return null;
    setBusy(true);
    try {
      return await run();
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setBusy(false);
    }
  };
  return { error, setError, busy, submit };
}
const DTO_POPOVER_KIND = `${DTO_TYPE}-create`;
function DtoSlashCreatePopover({
  editor,
  onClose
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [nameError, setNameError] = useState(null);
  const nameRef = useRef(null);
  useEffect(() => {
    const t = window.setTimeout(() => nameRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, []);
  const { error, busy, submit } = useSlashSubmit(async () => {
    const dto = await dtosApi.create({
      name: name.trim(),
      ...description.trim() ? { description: description.trim() } : {}
    });
    insertEmbed(editor, DTO_TYPE, dto.slug);
    toast.success(`DTO ${dto.name} created`);
    onClose();
    return dto;
  });
  const onSubmit = () => {
    if (!name.trim()) {
      setNameError("Name is required");
      return;
    }
    void submit();
  };
  return /* @__PURE__ */ jsxs(
    SlashPopoverShell,
    {
      width: 340,
      title: "New DTO",
      icon: /* @__PURE__ */ jsx(Braces, { size: 12, style: { color: "var(--c-accent)" } }),
      onCancel: onClose,
      children: [
        /* @__PURE__ */ jsx(FieldLabel, { children: "Name (PascalCase)" }),
        /* @__PURE__ */ jsx(
          TextInput,
          {
            ref: nameRef,
            value: name,
            onChange: (e) => {
              setName(e.target.value);
              if (nameError) setNameError(null);
            },
            onKeyDown: (e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onSubmit();
              }
            },
            placeholder: "UserResponse",
            style: { fontFamily: "ui-monospace, monospace" }
          }
        ),
        /* @__PURE__ */ jsxs("div", { style: { marginTop: 8 }, children: [
          /* @__PURE__ */ jsx(FieldLabel, { children: "Description (optional)" }),
          /* @__PURE__ */ jsx(
            TextInput,
            {
              value: description,
              onChange: (e) => setDescription(e.target.value),
              onKeyDown: (e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onSubmit();
                }
              },
              placeholder: "Returned by GET /users"
            }
          )
        ] }),
        /* @__PURE__ */ jsx(InlineError, { message: nameError ?? error }),
        /* @__PURE__ */ jsx(PopoverFooter, { onCancel: onClose, onSubmit, submitLabel: "Create", busy })
      ]
    }
  );
}
const mountDtoSlashCreate = () => mountSlashCreatePopover(DTO_POPOVER_KIND, DtoSlashCreatePopover);
const ENDPOINT_POPOVER_KIND = `${ENDPOINT_TYPE}-create`;
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
function EndpointSlashCreatePopover({
  editor,
  onClose
}) {
  const [method, setMethod] = useState("GET");
  const [path, setPath] = useState("/api/");
  const [summary, setSummary] = useState("");
  const [pathError, setPathError] = useState(null);
  const pathRef = useRef(null);
  useEffect(() => {
    const t = window.setTimeout(() => {
      pathRef.current?.focus();
      pathRef.current?.select();
    }, 0);
    return () => window.clearTimeout(t);
  }, []);
  const { error, busy, submit } = useSlashSubmit(async () => {
    const ep = await endpointsApi.create({
      method,
      path: path.trim(),
      ...summary.trim() ? { summary: summary.trim() } : {}
    });
    insertEmbed(editor, ENDPOINT_TYPE, ep.slug);
    toast.success(`Endpoint ${ep.method} ${ep.path} created`);
    onClose();
    return ep;
  });
  const onSubmit = () => {
    const trimmed = path.trim();
    if (!trimmed) {
      setPathError("Path is required");
      return;
    }
    if (!trimmed.startsWith("/")) {
      setPathError("Path must start with /");
      return;
    }
    void submit();
  };
  return /* @__PURE__ */ jsxs(
    SlashPopoverShell,
    {
      width: 360,
      title: "New endpoint",
      icon: /* @__PURE__ */ jsx(ArrowRightLeft, { size: 12, style: { color: "var(--c-accent)" } }),
      onCancel: onClose,
      children: [
        /* @__PURE__ */ jsxs("div", { style: { display: "flex", gap: 8, marginBottom: 8 }, children: [
          /* @__PURE__ */ jsxs("div", { style: { width: 100 }, children: [
            /* @__PURE__ */ jsx(FieldLabel, { children: "Method" }),
            /* @__PURE__ */ jsx(SelectInput, { value: method, onChange: (e) => setMethod(e.target.value), children: HTTP_METHODS.map((m) => /* @__PURE__ */ jsx("option", { value: m, children: m }, m)) })
          ] }),
          /* @__PURE__ */ jsxs("div", { style: { flex: 1, minWidth: 0 }, children: [
            /* @__PURE__ */ jsx(FieldLabel, { children: "Path" }),
            /* @__PURE__ */ jsx(
              TextInput,
              {
                ref: pathRef,
                value: path,
                onChange: (e) => {
                  setPath(e.target.value);
                  if (pathError) setPathError(null);
                },
                onKeyDown: (e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onSubmit();
                  }
                },
                placeholder: "/api/users",
                style: { fontFamily: "ui-monospace, monospace" }
              }
            )
          ] })
        ] }),
        /* @__PURE__ */ jsx(FieldLabel, { children: "Summary (optional)" }),
        /* @__PURE__ */ jsx(
          TextInput,
          {
            value: summary,
            onChange: (e) => setSummary(e.target.value),
            onKeyDown: (e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onSubmit();
              }
            },
            placeholder: "List all users"
          }
        ),
        /* @__PURE__ */ jsx(InlineError, { message: pathError ?? error }),
        /* @__PURE__ */ jsx(PopoverFooter, { onCancel: onClose, onSubmit, submitLabel: "Create", busy })
      ]
    }
  );
}
const mountEndpointSlashCreate = () => mountSlashCreatePopover(ENDPOINT_POPOVER_KIND, EndpointSlashCreatePopover);
registerFrontendModule(dtoFrontendModule);
registerFrontendModule(endpointFrontendModule);
const unmountDtoSlashCreate = mountDtoSlashCreate();
const unmountEndpointSlashCreate = mountEndpointSlashCreate();
export {
  unmountDtoSlashCreate,
  unmountEndpointSlashCreate
};
//# sourceMappingURL=frontend.js.map
