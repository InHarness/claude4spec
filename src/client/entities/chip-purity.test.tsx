// @vitest-environment jsdom
//
// Registration purity gate (brief 0.1.81 → 0.1.82, item 6).
//
// Every plugin-contributed entity slot — renderChip / renderCard / renderRow —
// must be PURE-PRESENTATIONAL under the host-resolver contract: it renders from
// its props alone. The shared `ChipResolver` does the fetching and injects the
// resolved `entity`; a slot must NOT fetch on its own (`useQuery` /
// `useGetBySlug`) nor reach into the editor (`useEditor()` / `useCurrentEditor()`).
//
// This test enforces that by rendering each slot in an ISOLATED React tree — no
// QueryClientProvider, no EditorBridgeProvider, no router. An impure slot throws
// at render ("No QueryClient set" / missing tiptap context) and fails here. That
// failure IS the gate: entities stay extractable into out-of-repo plugins only
// while this invariant holds.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { ComponentType } from 'react';
// Side-effect import: each plugin module calls registerEntity(...) on load.
import './index.js';
import {
  listEntityDefs,
  type EntityChipProps,
  type EntityRowProps,
} from './registry.js';

afterEach(cleanup);

// One fixture carrying every field any chip/card/row reads across all registered
// types. Slots receive `entity` typed as `unknown` (EntityDef is non-generic), so
// a single object serves every type. Every value is populated so no slot trips on
// `undefined` (e.g. ac's `truncate(entity.text)` or `entity.tags.map(...)`).
const FAKE_ENTITY: Record<string, unknown> = {
  slug: 'fake-slug',
  method: 'GET',
  path: '/things/{id}',
  summary: 'Fake summary',
  description: 'Fake description',
  tags: ['alpha'],
  name: 'Fake Name',
  fields: [],
  columns: [],
  indexes: [],
  params: [],
  examples: [],
  verifies: [],
  groups: [],
  modes: [],
  url: 'https://example.com',
  designSystemSlug: null,
  kind: 'must',
  status: 'active',
  text: 'Some acceptance criterion text',
  format: 'mermaid',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const noop = () => {};

const EXPECTED_TYPES = [
  'ac',
  'database-table',
  'design-system',
  'diagram',
  'dto',
  'endpoint',
  'ui-view',
];

describe('entity slots are pure-presentational (host-resolver contract)', () => {
  const defs = listEntityDefs();

  it('every host entity type is registered', () => {
    expect(defs.map((d) => d.type).sort()).toEqual(EXPECTED_TYPES);
  });

  for (const def of defs) {
    describe(def.type, () => {
      const Chip = def.renderChip as ComponentType<EntityChipProps<unknown>>;
      const Card = def.renderCard as ComponentType<EntityChipProps<unknown>>;
      const Row = def.renderRow as ComponentType<EntityRowProps<unknown>>;

      it('renderChip mounts with an injected entity — no fetch/editor context', () => {
        const { container } = render(
          <Chip slug="fake-slug" entity={FAKE_ENTITY} onOpen={noop} />,
        );
        expect(container.textContent).toBeTruthy();
      });

      it('renderChip renders a broken-state for entity: null', () => {
        const { container } = render(
          <Chip slug="fake-slug" entity={null} onOpen={noop} />,
        );
        expect(container.textContent).toContain('fake-slug');
      });

      it('renderCard mounts with an entity and a broken-state for null', () => {
        const ok = render(<Card slug="fake-slug" entity={FAKE_ENTITY} onOpen={noop} />);
        expect(ok.container.textContent).toBeTruthy();
        cleanup();
        const broken = render(<Card slug="fake-slug" entity={null} onOpen={noop} />);
        expect(broken.container.textContent).toContain('fake-slug');
      });

      it('renderRow mounts with a non-null entity (rows never receive null)', () => {
        const { container } = render(
          <Row slug="fake-slug" entity={FAKE_ENTITY} onOpen={noop} />,
        );
        // Rows render content for resolved entities; assert no throw + a tree.
        expect(container.firstChild).not.toBeNull();
      });
    });
  }
});
