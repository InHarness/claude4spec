import { registerFrontendModule } from "@c4s/plugin-runtime";
import { h as DIAGRAM_PATH_PREFIX, k as DIAGRAM_TYPE, c as DIAGRAM_DEFAULT_FORMAT, i as DIAGRAM_LABEL_PLURAL, j as DIAGRAM_LABEL, e as DIAGRAM_PAYLOAD_VERSION, f as diagramSlugPattern, g as diagramData, D as DIAGRAM_POPOVER_KIND } from "./schema-R4aIrSYQ.js";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { jsx, jsxs, Fragment } from "react/jsx-runtime";
import { useSyncExternalStore, useId, useMemo, useState, useEffect, useRef, useCallback, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { Minimize2, Maximize2, Share2, Pencil, ZoomOut, ZoomIn, Maximize, RotateCcw, X } from "lucide-react";
import { useHostTokens, LoadingState, Popover, FormShell, FormField, ActionButton, Badge, InlineEditField, Dialog, EmptyState } from "@c4s/plugin-runtime/ui";
const PROJECT_ID = typeof window !== "undefined" && window.__C4S_PROJECT__?.id || "";
const API_BASE = PROJECT_ID ? `/api/projects/${PROJECT_ID}` : "/api";
function apiFetch(input, init) {
  return fetch(input.startsWith("/api/") ? `${API_BASE}${input.slice("/api".length)}` : input, init);
}
class ApiError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
async function handle(res) {
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const err = body?.error;
    const code = (typeof err === "object" ? err?.code : body?.code) ?? "HTTP_ERROR";
    const message = (typeof err === "object" ? err?.message : err) ?? res.statusText;
    throw new ApiError(code, message, res.status);
  }
  return await res.json();
}
async function unwrap(res) {
  return (await handle(res)).data;
}
const many = `/api${DIAGRAM_PATH_PREFIX}`;
const one = (slug) => `${many}/${encodeURIComponent(slug)}`;
const json = (method, body) => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body)
});
const diagramsApi = {
  async get(slug) {
    return unwrap(await apiFetch(one(slug)));
  },
  /** The DSL body, through the host's content route — the same read an agent makes. */
  async source(slug) {
    const res = await apiFetch(`/api/entities/${DIAGRAM_TYPE}/${encodeURIComponent(slug)}/content/source`);
    return (await handle(res)).content;
  },
  /** The host's create route; the slug comes from `title` (`slugPattern`). */
  async create(input) {
    return unwrap(await apiFetch(many, json("POST", input)));
  },
  async update(slug, input) {
    return unwrap(await apiFetch(one(slug), json("PATCH", input)));
  }
};
const DIAGRAM_LIST_KEY = DIAGRAM_PATH_PREFIX.split("/").filter(Boolean).pop();
const diagramKeys = {
  all: [DIAGRAM_LIST_KEY],
  detail: (slug) => [DIAGRAM_TYPE, slug],
  source: (slug) => [DIAGRAM_TYPE, slug, "source"]
};
function useDiagram(slug) {
  return useQuery({
    queryKey: slug ? diagramKeys.detail(slug) : [DIAGRAM_TYPE, null],
    queryFn: async () => {
      try {
        return await diagramsApi.get(slug);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
    enabled: slug !== null
  });
}
function useDiagramSource(slug) {
  return useQuery({
    queryKey: slug ? diagramKeys.source(slug) : [DIAGRAM_TYPE, null, "source"],
    queryFn: () => diagramsApi.source(slug),
    enabled: slug !== null
  });
}
function useCreateDiagram() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input) => diagramsApi.create(input),
    onSuccess: (d) => {
      void qc.invalidateQueries({ queryKey: diagramKeys.all });
      qc.setQueryData(diagramKeys.detail(d.slug), d);
    }
  });
}
function useUpdateDiagram() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, input }) => diagramsApi.update(slug, input),
    onSuccess: (_d, { slug }) => {
      void qc.invalidateQueries({ queryKey: diagramKeys.all });
      void qc.invalidateQueries({ queryKey: diagramKeys.detail(slug) });
    }
  });
}
function readTheme() {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark") ? "dark" : "light";
}
function subscribe(onChange) {
  if (typeof document === "undefined" || typeof MutationObserver === "undefined") return () => {
  };
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}
function useTheme() {
  const effectiveTheme = useSyncExternalStore(subscribe, readTheme, () => "light");
  return { effectiveTheme };
}
const RENDERED_FORMATS = ["mermaid"];
function isRenderedFormat(format) {
  return RENDERED_FORMATS.includes(format);
}
function mermaidConfig(theme, tokens) {
  const t = (name) => tokens[name] || void 0;
  const card = t("--c-card");
  const panel = t("--c-panel");
  const accentInk = t("--c-accent-ink");
  const ink = t("--c-ink");
  const blue = t("--c-blue");
  const green = t("--c-green");
  const vars = {
    darkMode: theme === "dark",
    background: card,
    tertiaryColor: card,
    primaryColor: panel,
    primaryBorderColor: accentInk,
    lineColor: accentInk,
    textColor: ink,
    primaryTextColor: ink,
    secondaryColor: blue,
    secondaryTextColor: ink,
    secondaryBorderColor: blue,
    tertiaryTextColor: ink,
    tertiaryBorderColor: accentInk,
    clusterBkg: green,
    clusterBorder: green,
    titleColor: ink,
    edgeLabelBackground: card,
    nodeTextColor: ink
  };
  const themeVariables = Object.fromEntries(Object.entries(vars).filter(([, v]) => v !== void 0));
  return {
    startOnLoad: false,
    theme: "base",
    themeVariables,
    flowchart: { curve: "basis" },
    securityLevel: "strict"
  };
}
let loading = null;
let initializedWith = null;
function loadMermaid() {
  if (!loading) {
    loading = import("./mermaid.core-C1SGswPB.js").then((n) => n.cc).then((mod) => mod.default).catch((err) => {
      loading = null;
      throw err;
    });
  }
  return loading;
}
let chain = Promise.resolve();
function serialize(fn) {
  const next = chain.then(fn, fn);
  chain = next.catch(() => void 0);
  return next;
}
async function renderDiagram(format, source, id, theme, tokens) {
  if (!isRenderedFormat(format)) {
    return { ok: false, message: `Unsupported format: ${format}. Supported: ${RENDERED_FORMATS.join(", ")}` };
  }
  if (!source.trim()) return { ok: false, message: "Empty source" };
  try {
    const svg = await serialize(async () => {
      const mermaid = await loadMermaid();
      const config = mermaidConfig(theme, tokens);
      const key = JSON.stringify(config);
      if (initializedWith !== key) {
        mermaid.initialize(config);
        initializedWith = key;
      }
      await mermaid.parse(source);
      return (await mermaid.render(id, source)).svg;
    });
    return { ok: true, svg };
  } catch (err) {
    const e = err;
    return { ok: false, message: e?.message ?? "Render failed", line: e?.hash?.loc?.first_line };
  }
}
function sanitizeRenderId(raw) {
  return `diagram-${raw.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}
function hashSource(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = h * 31 + s.charCodeAt(i) | 0;
  return Math.abs(h).toString(36);
}
function useDiagramSvg(format, source, idScope) {
  const { effectiveTheme } = useTheme();
  const tokens = useHostTokens();
  const instanceId = useId();
  const renderId = useMemo(
    () => sanitizeRenderId(`${idScope}-${format}-${effectiveTheme}-${hashSource(source)}-${instanceId}`),
    [idScope, format, effectiveTheme, source, instanceId]
  );
  const [state, setState] = useState({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    if (!isRenderedFormat(format)) {
      setState({ status: "error", message: `Unsupported format: ${format}. Supported: mermaid` });
      return;
    }
    if (!source.trim()) {
      setState({ status: "empty" });
      return;
    }
    setState({ status: "loading" });
    void renderDiagram(format, source, renderId, effectiveTheme, tokens).then((result) => {
      if (cancelled) return;
      setState(result.ok ? { status: "rendered", svg: result.svg } : { status: "error", message: result.message, line: result.line });
    });
    return () => {
      cancelled = true;
    };
  }, [format, source, renderId, effectiveTheme, tokens]);
  return state;
}
function DiagramRender({ format, source, idScope }) {
  const state = useDiagramSvg(format, source, idScope);
  if (state.status === "rendered") {
    return /* @__PURE__ */ jsx("div", { className: "diagrams-render diagrams-render__svg", dangerouslySetInnerHTML: { __html: state.svg } });
  }
  return /* @__PURE__ */ jsx(DiagramRenderFallback, { state, source });
}
function DiagramRenderFallback({
  state,
  source
}) {
  switch (state.status) {
    case "empty":
      return /* @__PURE__ */ jsx("div", { className: "diagrams-render diagrams-render--empty", children: "Empty diagram" });
    case "loading":
      return /* @__PURE__ */ jsx(LoadingState, { height: 120 });
    case "error":
      return /* @__PURE__ */ jsxs("div", { className: "diagrams-render diagrams-render--error", role: "alert", children: [
        /* @__PURE__ */ jsxs("div", { className: "diagrams-render__banner", children: [
          /* @__PURE__ */ jsx("strong", { children: "Diagram error" }),
          state.line !== void 0 ? ` (line ${state.line})` : "",
          ": ",
          state.message
        ] }),
        /* @__PURE__ */ jsx("pre", { className: "diagrams-render__source", children: source })
      ] });
  }
}
const PREVIEW_DEBOUNCE_MS = 300;
const WIDTH = 620;
const FULLSCREEN_SHARE = 0.9;
const NO_CARET_TOP = 48;
function useDebounced(value, ms) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setSettled(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return settled;
}
function DiagramForm({
  mode,
  initial,
  captionEditable = true,
  at,
  busy = false,
  error,
  locked = false,
  onSubmit,
  onCancel,
  onRemove
}) {
  const start = {
    format: initial?.format ?? DIAGRAM_DEFAULT_FORMAT,
    title: initial?.title ?? "",
    caption: initial?.caption ?? "",
    source: initial?.source ?? ""
  };
  const [format, setFormat] = useState(start.format);
  const [title, setTitle] = useState(start.title);
  const [caption, setCaption] = useState(start.caption);
  const [source, setSource] = useState(start.source);
  const [fullscreen, setFullscreen] = useState(false);
  const sourceRef = useRef(null);
  const previewSource = useDebounced(source, PREVIEW_DEBOUNCE_MS);
  const preview = useDiagramSvg(format, previewSource, "preview");
  const previewError = preview.status === "error" ? preview : null;
  useEffect(() => {
    const t = window.setTimeout(() => sourceRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, []);
  const dirty = format !== start.format || title !== start.title || caption !== start.caption || source !== start.source;
  const canSubmit = !busy && !locked && title.trim().length > 0 && source.trim().length > 0 && previewError === null && (mode === "create" || dirty);
  function submit() {
    if (!canSubmit) return;
    onSubmit({ format, title: title.trim(), caption: caption.trim(), source });
  }
  function onSourceKeyDown(e) {
    if (e.key !== "Tab" || e.metaKey || e.ctrlKey || e.altKey) return;
    e.preventDefault();
    const ta = e.currentTarget;
    const { selectionStart: from, selectionEnd: to } = ta;
    setSource(source.slice(0, from) + "  " + source.slice(to));
    window.setTimeout(() => {
      ta.selectionStart = ta.selectionEnd = from + 2;
    }, 0);
  }
  const viewportW = typeof window !== "undefined" ? window.innerWidth : 1280;
  const viewportH = typeof window !== "undefined" ? window.innerHeight : 800;
  const width = fullscreen ? Math.round(viewportW * FULLSCREEN_SHARE) : WIDTH;
  const position = fullscreen ? { x: Math.round(viewportW * (1 - FULLSCREEN_SHARE) / 2), y: Math.round(viewportH * (1 - FULLSCREEN_SHARE) / 2) } : at ?? { x: Math.max(0, Math.round((viewportW - WIDTH) / 2)), y: NO_CARET_TOP };
  const sourceError = previewError ? previewError.line !== void 0 ? `Line ${previewError.line}: ${previewError.message}` : previewError.message : null;
  return /* @__PURE__ */ jsx(
    Popover,
    {
      open: true,
      onClose: onCancel,
      at: position,
      width,
      title: mode === "edit" ? "Edit diagram" : "New diagram",
      icon: /* @__PURE__ */ jsx(Share2, { size: 12 }),
      children: /* @__PURE__ */ jsx(
        "div",
        {
          className: `diagrams-form${fullscreen ? " diagrams-form--fullscreen" : ""}`,
          "data-testid": "diagram-form",
          onKeyDown: (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          },
          children: /* @__PURE__ */ jsx(
            FormShell,
            {
              onSubmit: (e) => {
                e.preventDefault();
                submit();
              },
              busy,
              error: error ?? null,
              actions: /* @__PURE__ */ jsxs(Fragment, { children: [
                onRemove && /* @__PURE__ */ jsx(ActionButton, { label: "Remove", variant: "ghost", onClick: onRemove }),
                /* @__PURE__ */ jsx(ActionButton, { label: "Cancel", variant: "secondary", onClick: onCancel }),
                /* @__PURE__ */ jsx(
                  ActionButton,
                  {
                    label: mode === "edit" ? "Save" : "Insert",
                    variant: "primary",
                    type: "submit",
                    disabled: !canSubmit
                  }
                )
              ] }),
              children: /* @__PURE__ */ jsxs("div", { className: "diagrams-form__grid", children: [
                /* @__PURE__ */ jsxs("div", { className: "diagrams-form__fields", children: [
                  /* @__PURE__ */ jsxs("div", { className: "diagrams-form__row", children: [
                    /* @__PURE__ */ jsx(FormField, { label: "Format", children: /* @__PURE__ */ jsxs(
                      "select",
                      {
                        className: "diagrams-form__input diagrams-form__format",
                        "data-field": "format",
                        value: format,
                        onChange: (e) => setFormat(e.target.value),
                        children: [
                          /* @__PURE__ */ jsx("option", { value: "mermaid", children: "Mermaid" }),
                          /* @__PURE__ */ jsx("option", { value: "d2", disabled: true, title: "coming soon", children: "D2 (coming soon)" })
                        ]
                      }
                    ) }),
                    /* @__PURE__ */ jsx("span", { className: "diagrams-form__spacer" }),
                    /* @__PURE__ */ jsx(
                      ActionButton,
                      {
                        label: "",
                        variant: "ghost",
                        icon: fullscreen ? /* @__PURE__ */ jsx(Minimize2, { size: 14 }) : /* @__PURE__ */ jsx(Maximize2, { size: 14 }),
                        title: fullscreen ? "Exit fullscreen" : "Fullscreen",
                        onClick: () => setFullscreen((f) => !f)
                      }
                    )
                  ] }),
                  /* @__PURE__ */ jsx(FormField, { label: "Title", children: /* @__PURE__ */ jsx(
                    "input",
                    {
                      className: "diagrams-form__input",
                      "data-field": "title",
                      value: title,
                      placeholder: "Auth flow",
                      onChange: (e) => setTitle(e.target.value)
                    }
                  ) }),
                  captionEditable && /* @__PURE__ */ jsx(FormField, { label: "Caption (optional)", children: /* @__PURE__ */ jsx(
                    "input",
                    {
                      className: "diagrams-form__input",
                      "data-field": "caption",
                      value: caption,
                      placeholder: "Shown under this embed",
                      onChange: (e) => setCaption(e.target.value)
                    }
                  ) }),
                  /* @__PURE__ */ jsx(FormField, { label: "Source", error: sourceError, children: /* @__PURE__ */ jsx(
                    "textarea",
                    {
                      ref: sourceRef,
                      className: "diagrams-form__input diagrams-form__source",
                      "data-field": "source",
                      value: source,
                      spellCheck: false,
                      placeholder: "flowchart TD\n  A[Start] --> B[End]",
                      onChange: (e) => setSource(e.target.value),
                      onKeyDown: onSourceKeyDown
                    }
                  ) })
                ] }),
                /* @__PURE__ */ jsx(FormField, { label: "Preview", children: /* @__PURE__ */ jsx(DiagramPreview, { state: preview }) })
              ] })
            }
          )
        }
      )
    }
  );
}
function DiagramPreview({ state }) {
  switch (state.status) {
    case "empty":
      return /* @__PURE__ */ jsx("div", { className: "diagrams-form__preview diagrams-form__preview--note", children: "Type source to preview" });
    case "loading":
      return /* @__PURE__ */ jsx("div", { className: "diagrams-form__preview", children: /* @__PURE__ */ jsx(LoadingState, { height: 120 }) });
    case "error":
      return /* @__PURE__ */ jsx("div", { className: "diagrams-form__preview diagrams-form__preview--error", role: "alert", "data-testid": "diagram-preview-error", children: state.message });
    case "rendered":
      return /* @__PURE__ */ jsx(
        "div",
        {
          className: "diagrams-form__preview diagrams-render__svg",
          "data-testid": "diagram-preview",
          dangerouslySetInnerHTML: { __html: state.svg }
        }
      );
  }
}
function DiagramChip({ slug, entity, onOpen }) {
  const diagram = entity;
  if (!diagram) return /* @__PURE__ */ jsx(Badge, { variant: "broken", label: slug });
  const label = diagram.title || diagram.slug;
  return /* @__PURE__ */ jsxs("button", { type: "button", className: "diagrams-chip", onClick: onOpen, title: label, children: [
    /* @__PURE__ */ jsx(Share2, { size: 11, className: "diagrams-chip__icon", "aria-hidden": "true" }),
    /* @__PURE__ */ jsx("span", { className: "diagrams-chip__title", children: label })
  ] });
}
function DiagramCard({ slug, entity, caption, onCaptionChange }) {
  const diagram = entity;
  if (!diagram) return /* @__PURE__ */ jsx(Badge, { variant: "broken", label: slug });
  return /* @__PURE__ */ jsx(DiagramFigure, { diagram, caption, onCaptionChange });
}
function DiagramFigure({
  diagram,
  caption,
  onCaptionChange
}) {
  const sourceQuery = useDiagramSource(diagram.slug);
  const format = diagram.format ?? "mermaid";
  const pencilRef = useRef(null);
  const [editAt, setEditAt] = useState(null);
  return /* @__PURE__ */ jsxs("figure", { className: "diagrams-card", children: [
    sourceQuery.data !== void 0 && /* @__PURE__ */ jsx("span", { ref: pencilRef, className: "diagrams-card__edit", children: /* @__PURE__ */ jsx(
      ActionButton,
      {
        label: "",
        variant: "ghost",
        icon: /* @__PURE__ */ jsx(Pencil, { size: 13 }),
        title: "Edit diagram source",
        onClick: () => {
          const rect = pencilRef.current?.getBoundingClientRect();
          setEditAt({ x: rect?.left ?? 100, y: (rect?.bottom ?? 100) + 4 });
        }
      }
    ) }),
    editAt && sourceQuery.data !== void 0 && createPortal(
      /* @__PURE__ */ jsx(
        DiagramEditForm,
        {
          diagram,
          source: sourceQuery.data,
          caption,
          onCaptionChange,
          at: editAt,
          onClose: () => setEditAt(null)
        }
      ),
      document.body
    ),
    sourceQuery.data === void 0 ? sourceQuery.isError ? /* @__PURE__ */ jsx("div", { className: "diagrams-render diagrams-render--error", role: "alert", children: /* @__PURE__ */ jsxs("div", { className: "diagrams-render__banner", children: [
      /* @__PURE__ */ jsx("strong", { children: "Diagram error" }),
      ": could not load the source"
    ] }) }) : /* @__PURE__ */ jsx(LoadingState, { height: 120 }) : /* @__PURE__ */ jsx(DiagramRender, { format, source: sourceQuery.data, idScope: `card-${diagram.slug}` }),
    caption && /* @__PURE__ */ jsx("figcaption", { className: "diagrams-card__caption", children: onCaptionChange ? /* @__PURE__ */ jsx(
      InlineEditField,
      {
        value: caption,
        placeholder: "Caption",
        onCommit: (raw) => {
          const next = raw.trim() ? raw : null;
          if (next !== caption) onCaptionChange(next);
        }
      }
    ) : caption })
  ] });
}
function DiagramEditForm({
  diagram,
  source,
  caption,
  onCaptionChange,
  at,
  onClose
}) {
  const update = useUpdateDiagram();
  const [error, setError] = useState(null);
  const format = diagram.format ?? "mermaid";
  async function submit(values) {
    setError(null);
    const nextCaption = values.caption ? values.caption : null;
    if (onCaptionChange && nextCaption !== (caption ?? null)) onCaptionChange(nextCaption);
    const recordChanged = values.title !== diagram.title || values.source !== source || values.format !== format;
    if (!recordChanged) {
      onClose();
      return;
    }
    try {
      await update.mutateAsync({
        slug: diagram.slug,
        input: { title: values.title, source: values.source, format: values.format }
      });
      onClose();
    } catch (err) {
      setError(err.message);
    }
  }
  return /* @__PURE__ */ jsx(
    DiagramForm,
    {
      mode: "edit",
      at,
      initial: { format, title: diagram.title ?? "", caption: caption ?? "", source },
      captionEditable: !!onCaptionChange,
      busy: update.isPending,
      error,
      onSubmit: (values) => void submit(values),
      onCancel: onClose,
      onRemove: onClose
    }
  );
}
const diagramEmbedSlots = {
  renderChip: DiagramChip,
  renderCard: DiagramCard,
  useGetBySlug: (slug) => useDiagram(slug),
  listByTags: (async () => [])
};
const MIN_SCALE = 0.1;
const MAX_SCALE = 12;
const ZOOM_STEP = 1.2;
const WHEEL_STEP = 1.15;
const FIT_PADDING = 40;
const FIT_MAX = 4;
function DiagramFullscreen({ slug, caption, onClose }) {
  const width = useViewportWidth();
  return /* @__PURE__ */ jsx(Dialog, { open: true, onClose, ariaLabel: "Diagram", width, children: /* @__PURE__ */ jsxs("figure", { className: "diagrams-fullscreen", children: [
    /* @__PURE__ */ jsx(DiagramWindowBody, { slug, onClose }),
    caption && /* @__PURE__ */ jsx("figcaption", { className: "diagrams-fullscreen__caption", children: caption }),
    /* @__PURE__ */ jsx("div", { className: "diagrams-fullscreen__hint", children: "Scroll = zoom · drag = pan · F = fit · 0 = 100% · Esc = close" })
  ] }) });
}
function DiagramWindowBody({ slug, onClose }) {
  const record = useDiagram(slug);
  const source = useDiagramSource(slug);
  if (record.data === null) {
    return /* @__PURE__ */ jsxs(Fragment, { children: [
      /* @__PURE__ */ jsx(Toolbar, { onClose }),
      /* @__PURE__ */ jsx(EmptyState, { title: "Diagram not found", hint: slug })
    ] });
  }
  if (record.data === void 0 || source.data === void 0) {
    const failed = record.isError || source.isError;
    return /* @__PURE__ */ jsxs(Fragment, { children: [
      /* @__PURE__ */ jsx(Toolbar, { onClose }),
      failed ? /* @__PURE__ */ jsx("div", { className: "diagrams-render diagrams-render--error", role: "alert", children: /* @__PURE__ */ jsxs("div", { className: "diagrams-render__banner", children: [
        /* @__PURE__ */ jsx("strong", { children: "Diagram error" }),
        ": could not load the diagram"
      ] }) }) : /* @__PURE__ */ jsx(LoadingState, { height: 120 })
    ] });
  }
  return /* @__PURE__ */ jsx(DiagramStage, { slug, format: record.data.format ?? "mermaid", source: source.data, onClose });
}
function DiagramStage({
  slug,
  format,
  source,
  onClose
}) {
  const state = useDiagramSvg(format, source, `overlay-${slug}`);
  if (state.status !== "rendered") {
    return /* @__PURE__ */ jsxs(Fragment, { children: [
      /* @__PURE__ */ jsx(Toolbar, { onClose }),
      /* @__PURE__ */ jsx(DiagramRenderFallback, { state, source })
    ] });
  }
  return /* @__PURE__ */ jsx(PanZoom, { svg: state.svg, onClose });
}
const clampScale = (s) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, s));
function zoomAt(view, factor, ax, ay) {
  const scale = clampScale(view.scale * factor);
  const k = scale / view.scale;
  return { scale, x: ax - (ax - view.x) * k, y: ay - (ay - view.y) * k };
}
const IDENTITY = { scale: 1, x: 0, y: 0 };
function PanZoom({ svg, onClose }) {
  const stageRef = useRef(null);
  const contentRef = useRef(null);
  const [view, setView] = useState(IDENTITY);
  const viewRef = useRef(view);
  viewRef.current = view;
  const drag = useRef(null);
  const [dragging, setDragging] = useState(false);
  const stageCentre = () => {
    const rect = stageRef.current?.getBoundingClientRect();
    return { x: (rect?.width ?? 0) / 2, y: (rect?.height ?? 0) / 2 };
  };
  const zoomBy = useCallback((factor) => {
    const c = stageCentre();
    setView((v) => zoomAt(v, factor, c.x, c.y));
  }, []);
  const reset = useCallback(() => setView(IDENTITY), []);
  const fit = useCallback(() => {
    const stage = stageRef.current;
    const svgEl = contentRef.current?.querySelector("svg");
    if (!stage || !svgEl) return;
    const rect = stage.getBoundingClientRect();
    const box = svgEl.getBoundingClientRect();
    const scale = viewRef.current.scale;
    const w = box.width / scale;
    const h = box.height / scale;
    if (!w || !h || !rect.width || !rect.height) return;
    const next = clampScale(Math.min((rect.width - FIT_PADDING * 2) / w, (rect.height - FIT_PADDING * 2) / h, FIT_MAX));
    setView({ scale: next, x: (rect.width - w * next) / 2, y: (rect.height - h * next) / 2 });
  }, []);
  useLayoutEffect(() => {
    fit();
  }, [svg, fit]);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (e) => {
      e.preventDefault();
      const rect = stage.getBoundingClientRect();
      setView((v) => zoomAt(v, e.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP, e.clientX - rect.left, e.clientY - rect.top));
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, []);
  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const act = {
        "+": () => zoomBy(ZOOM_STEP),
        "=": () => zoomBy(ZOOM_STEP),
        "-": () => zoomBy(1 / ZOOM_STEP),
        _: () => zoomBy(1 / ZOOM_STEP),
        "0": reset,
        f: fit,
        F: fit
      };
      const run = act[e.key];
      if (!run) return;
      e.preventDefault();
      run();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [zoomBy, reset, fit]);
  return /* @__PURE__ */ jsxs(Fragment, { children: [
    /* @__PURE__ */ jsx(
      Toolbar,
      {
        onClose,
        zoom: {
          percent: Math.round(view.scale * 100),
          zoomIn: () => zoomBy(ZOOM_STEP),
          zoomOut: () => zoomBy(1 / ZOOM_STEP),
          fit,
          reset
        }
      }
    ),
    /* @__PURE__ */ jsx(
      "div",
      {
        ref: stageRef,
        className: `diagrams-fullscreen__stage${dragging ? " diagrams-fullscreen__stage--dragging" : ""}`,
        "data-testid": "diagram-stage",
        onPointerDown: (e) => {
          if (e.button !== 0) return;
          drag.current = { x: e.clientX, y: e.clientY, ox: viewRef.current.x, oy: viewRef.current.y };
          setDragging(true);
          e.currentTarget.setPointerCapture?.(e.pointerId);
        },
        onPointerMove: (e) => {
          const d = drag.current;
          if (!d) return;
          setView((v) => ({ ...v, x: d.ox + e.clientX - d.x, y: d.oy + e.clientY - d.y }));
        },
        onPointerUp: () => {
          drag.current = null;
          setDragging(false);
        },
        onPointerCancel: () => {
          drag.current = null;
          setDragging(false);
        },
        children: /* @__PURE__ */ jsx(
          "div",
          {
            ref: contentRef,
            className: "diagrams-fullscreen__content",
            style: { transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` },
            dangerouslySetInnerHTML: { __html: svg }
          }
        )
      }
    )
  ] });
}
function Toolbar({
  onClose,
  zoom
}) {
  return /* @__PURE__ */ jsxs("div", { className: "diagrams-fullscreen__toolbar", children: [
    /* @__PURE__ */ jsx("span", { className: "diagrams-fullscreen__label", children: "Diagram" }),
    /* @__PURE__ */ jsx("span", { className: "diagrams-fullscreen__spacer" }),
    zoom && /* @__PURE__ */ jsxs(Fragment, { children: [
      /* @__PURE__ */ jsx(ActionButton, { variant: "ghost", icon: /* @__PURE__ */ jsx(ZoomOut, { size: 14 }), label: "", title: "Zoom out (−)", onClick: zoom.zoomOut }),
      /* @__PURE__ */ jsxs("span", { className: "diagrams-fullscreen__percent", "data-testid": "diagram-zoom", children: [
        zoom.percent,
        "%"
      ] }),
      /* @__PURE__ */ jsx(ActionButton, { variant: "ghost", icon: /* @__PURE__ */ jsx(ZoomIn, { size: 14 }), label: "", title: "Zoom in (+)", onClick: zoom.zoomIn }),
      /* @__PURE__ */ jsx(ActionButton, { variant: "ghost", icon: /* @__PURE__ */ jsx(Maximize, { size: 14 }), label: "", title: "Fit to screen (F)", onClick: zoom.fit }),
      /* @__PURE__ */ jsx(ActionButton, { variant: "ghost", icon: /* @__PURE__ */ jsx(RotateCcw, { size: 14 }), label: "", title: "Reset to 100% (0)", onClick: zoom.reset })
    ] }),
    /* @__PURE__ */ jsx(ActionButton, { variant: "ghost", icon: /* @__PURE__ */ jsx(X, { size: 16 }), label: "", title: "Close (Esc)", onClick: onClose })
  ] });
}
function useViewportWidth() {
  return useSyncExternalStore(
    (onChange) => {
      window.addEventListener("resize", onChange);
      return () => window.removeEventListener("resize", onChange);
    },
    () => window.innerWidth,
    () => 1280
  );
}
const diagramFrontendModule = {
  type: DIAGRAM_TYPE,
  data: diagramData,
  slugPattern: diagramSlugPattern,
  payloadVersion: DIAGRAM_PAYLOAD_VERSION,
  label: DIAGRAM_LABEL,
  labelPlural: DIAGRAM_LABEL_PLURAL,
  pathPrefix: DIAGRAM_PATH_PREFIX,
  ...diagramEmbedSlots,
  renderOverlay: DiagramFullscreen
};
const TOAST_EVENT = "c4s:toast";
function fireToast(variant, message, options) {
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: { variant, message, ...options } }));
}
const toast = {
  success: (message, options) => fireToast("success", message, options),
  error: (message, options) => fireToast("error", message, options),
  warning: (message, options) => fireToast("warning", message, options),
  info: (message, options) => fireToast("info", message, options)
};
const PLUGIN_COMMAND_EVENT = "c4s:plugin-command";
const EMBED_NODE = "single_element";
function insertEmbed(editor, type, slug, extra = {}) {
  if (editor.isDestroyed) return false;
  try {
    return editor.chain().focus().insertContent({ type: EMBED_NODE, attrs: { type, slug, ...extra } }).run();
  } catch {
    return false;
  }
}
const MOUNTS_KEY = "__c4sSlashCreateMounts";
function liveMounts() {
  const w = window;
  return w[MOUNTS_KEY] ??= /* @__PURE__ */ new Map();
}
function mountSlashCreatePopover(kind, Component) {
  if (typeof window === "undefined" || typeof document === "undefined") return () => void 0;
  liveMounts().get(kind)?.();
  let host = null;
  let root = null;
  let invocation = 0;
  const close = () => root?.render(null);
  const onEvent = (ev) => {
    const d = ev.detail;
    if (d?.popoverKind !== kind || !d.editor) return;
    const props = { editor: d.editor, coords: d.coords ?? null, currentPath: d.currentPath ?? null, onClose: close };
    const key = ++invocation;
    void (async () => {
      const [{ createRoot }, { queryClient }, { QueryClientProvider }, { createElement }] = await Promise.all([
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
          { client: queryClient },
          createElement(Component, { ...props, key })
        )
      );
    })();
  };
  window.addEventListener(PLUGIN_COMMAND_EVENT, onEvent);
  const dispose = () => {
    window.removeEventListener(PLUGIN_COMMAND_EVENT, onEvent);
    root?.unmount();
    root = null;
    host?.remove();
    host = null;
    if (liveMounts().get(kind) === dispose) liveMounts().delete(kind);
  };
  liveMounts().set(kind, dispose);
  return dispose;
}
function notEmbeddedMessage(title, slug) {
  return `Diagram “${title}” (slug: ${slug}) was created but could not be embedded in the document. You can embed it manually.`;
}
function DiagramSlashCreate({ editor, coords, onClose }) {
  const create = useCreateDiagram();
  const [notEmbedded, setNotEmbedded] = useState(null);
  async function submit(values) {
    let diagram;
    try {
      diagram = await create.mutateAsync({ title: values.title, source: values.source, format: values.format });
    } catch (err) {
      toast.error(err.message);
      onClose();
      return;
    }
    const attrs = values.caption ? { caption: values.caption } : {};
    if (insertEmbed(editor, DIAGRAM_TYPE, diagram.slug, attrs)) {
      onClose();
      return;
    }
    setNotEmbedded(diagram);
  }
  return /* @__PURE__ */ jsx(
    DiagramForm,
    {
      mode: "create",
      at: coords,
      busy: create.isPending,
      locked: notEmbedded !== null,
      error: notEmbedded ? notEmbeddedMessage(notEmbedded.title || notEmbedded.slug, notEmbedded.slug) : null,
      onSubmit: (values) => void submit(values),
      onCancel: onClose
    }
  );
}
function mountDiagramSlashCreate() {
  return mountSlashCreatePopover(DIAGRAM_POPOVER_KIND, DiagramSlashCreate);
}
registerFrontendModule(diagramFrontendModule);
mountDiagramSlashCreate();
//# sourceMappingURL=frontend.js.map
