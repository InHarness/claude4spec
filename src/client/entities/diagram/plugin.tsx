import { Share2 } from 'lucide-react';
import type { ComponentType } from 'react';
import type { Diagram } from '../../../shared/entities.js';
import { diagramData, diagramSlugPattern } from '../../../shared/entities/diagram/schema.js';
import { useDiagram } from '../../hooks/useDiagrams.js';
import type { EntityCardProps, EntityChipProps } from '../registry.js';
import { clientPluginHost } from '../../core/plugin-host/host.js';
import type { FrontendModule } from '../../core/plugin-host/types.js';
import { DiagramCard, DiagramOverlay } from './DiagramCard.js';
import { Badge } from '../../host-ui-kit/actions/Badge.js';

/**
 * 0.2.15 — what is left of the diagram's editor presence after `DiagramNode`
 * was deleted: the AUTHORING affordance and nothing else.
 *
 * No `extension` (no ProseMirror node) and no `markdownIt` rule — a diagram
 * parses and serialises as `<single_element type="diagram" …/>` through the
 * generic node. This registration exists purely so `/diagram` still appears in
 * the slash menu; `slashInvoke` opens the create popover, writes the entity,
 * and inserts the generic tag.
 *
 * The rename from the old `diagram` registration is the point: an entity
 * contributes authoring UI, never a tag.
 */
export const diagramAuthoringExtension = {
  name: 'diagram_authoring',
  priority: 670,
  availableIn: ['page', 'plan'] as const,
  slashCommand: {
    id: 'diagram',
    label: '/diagram',
    description: 'Insert a Mermaid diagram',
    hint: 'mermaid DSL',
  },
};

function DiagramChip({ slug, entity, onOpen }: EntityChipProps<Diagram>) {
  // 2.1.40 (M13): a deleted diagram is the catalog's broken `Badge` with the
  // slug — not clickable, `onOpen` is not wired in this branch.
  if (!entity) return <Badge variant="broken" label={slug} />;
  return (
    <button
      onClick={onOpen}
      className="inline-flex items-center gap-1 align-middle rounded px-1.5 py-[1px] transition"
      style={{ border: '1px solid var(--c-hair)', background: 'var(--c-card)', fontSize: 12 }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--c-hair-strong)')}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--c-hair)')}
      title={`diagram: ${entity.slug}`}
    >
      <Share2 size={11} style={{ color: 'var(--c-accent)' }} />
      {/*
        0.2.22 — the label is `title`, and this chip is where the reserved field
        shows most plainly: `diagram` had no name at all, so a chip could only
        ever render a kebab slug in a monospace face. It renders prose now, so
        the monospace goes with the slug it was there for.
      */}
      <span style={{ color: 'var(--c-ink)' }}>{entity.title || entity.slug}</span>
    </button>
  );
}

/**
 * `diagram` is a HIDDEN entity: no sidebar tab, no `routes`, no `detailPanel`,
 * and therefore no `renderRow` either.
 *
 * That is not a demotion, it is the shape being stated. Diagram never had a
 * sidebar tab or a `/diagrams/$slug` route — `editorBridge.openEntity('diagram', …)`
 * pointed at a route that does not exist, so the row and the detail panel were
 * unreachable surfaces satisfying a slot check.
 *
 * 0.2.16 — hidden-ness is no longer declared with a flag. Omitting `routes` and
 * `detailPanel` IS the declaration; `renderOverlay` is what the host requires in
 * exchange.
 *
 * 2.1.20 (c4s-plugin-diagram L11, M13 `z7l89jhf` / `chipprops`) — the type's
 * frontend is a module of shape `FrontendModule`, separate from the type's
 * contribution (the server's `diagramBackendModule` carries no frontend). Its
 * slots, as the diagram page lists them:
 *
 *   - `renderCard`   — `DiagramCard`: SVG (lazy mermaid) + `<figcaption>`; its
 *                      `Maximize2` button calls the host's `onOpen` and nothing else;
 *   - `renderChip`   — `DiagramChip`: a pill with `title`; a click is routed by the
 *                      HOST to the `diagram-expand` window — the chip opens nothing
 *                      itself (its handler IS the host's `onOpen`);
 *   - `renderOverlay`— `DiagramOverlay`: the content of `diagram-expand` (required —
 *                      the type is hidden), rendered in `DiagramFullscreen`;
 *   - `editorExtensions` — `[diagramAuthoringExtension]`: `/diagram` + the
 *                      create/edit popover, no node of its own;
 *   - the four required slots are all there (`listByTags` answers empty — a
 *     hidden type is not listed);
 *   - NOT supplied: `sidebarTab`, `routes`, `detailPanel`, `renderRow` — so
 *     `element_list` / `tagged_list` with `type="diagram"` are unsupported by
 *     contract; the list views say so inline rather than rendering blanks.
 *
 * `diagram` is built into the host bundle, so it does NOT call the plugin
 * runtime's `registerFrontendModule`: it enters the client registry through the
 * host's own door (`clientPluginHost.registerFrontendModule`), which is not part
 * of the plugin contract. The editor extension is pinned by `mountFrontend`,
 * like every module's.
 */
export const diagramFrontendModule: FrontendModule = {
  type: 'diagram',
  data: diagramData,
  slugPattern: diagramSlugPattern,
  payloadVersion: 2,
  label: 'Diagram',
  labelPlural: 'Diagrams',
  pathPrefix: '/diagrams',

  renderChip: DiagramChip as ComponentType<EntityChipProps<unknown>>,
  renderCard: DiagramCard as ComponentType<EntityCardProps<unknown>>,
  renderOverlay: DiagramOverlay,
  useGetBySlug: (slug) => useDiagram(slug),
  // A hidden type is not listed: tag-driven lists have nothing to render for it.
  listByTags: async () => [],

  editorExtensions: [{ ...diagramAuthoringExtension, availableIn: [...diagramAuthoringExtension.availableIn] }],
};

clientPluginHost.registerFrontendModule(diagramFrontendModule);
