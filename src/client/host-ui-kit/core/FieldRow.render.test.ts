// @vitest-environment happy-dom
/**
 * M13 → M34/L12 — `FieldRow` (group `core`, `stable`, contributed by M13)
 * against its `ui-kit-component` record `field-row` (2.1.28).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { FieldRow, type FieldRowProps } from './FieldRow.js';
import type * as Published from '../../../plugin-types/ui.js';
import { VERSIONED_UI_KIT_COMPONENTS } from '../../../shared/plugin-host/host-api.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? ([keyof A] extends [keyof B] ? ([keyof B] extends [keyof A] ? true : false) : false) : false) : false;

/** The record's `props`. */
interface RecordFieldRowProps {
  label: ReactNode;
  children: ReactNode;
  align?: 'center' | 'start';
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const mount = (props: FieldRowProps) => act(() => root.render(createElement(FieldRow, props)));

describe('FieldRow ↔ record `field-row` (M13/M34, 2.1.28)', () => {
  it('[entity:field-row] takes exactly the record props (host and published /ui alike) — no `value` prop — counted into hostApiVersion as stable', () => {
    const a: Same<FieldRowProps, RecordFieldRowProps> = true;
    const b: Same<Published.FieldRowProps, RecordFieldRowProps> = true;
    expect([a, b]).toEqual([true, true]);
    const keys: Array<keyof FieldRowProps> = ['label', 'children', 'align'];
    expect(keys).not.toContain('value');
    expect(VERSIONED_UI_KIT_COMPONENTS).toContain('FieldRow');
  });

  it('[entity:field-row] puts the label in a 140 px column and aligns center by default, start on request', () => {
    mount({ label: 'Status', children: 'draft' });
    const row = host.firstElementChild as HTMLElement;
    const labelCol = row.children[0] as HTMLElement;
    expect(labelCol.style.width).toBe('140px');
    expect(row.style.alignItems).toBe('center');
    mount({ label: 'Description', children: 'long text', align: 'start' });
    expect((host.firstElementChild as HTMLElement).style.alignItems).toBe('flex-start');
  });

  it('[ac:ac-fieldrow-renderuje-jeden-wiersz-pary] renders one field–value row: `label` as the field and `children` as the value', () => {
    mount({
      label: 'Owner',
      children: [
        createElement('span', { key: 'chip', 'data-testid': 'chip' }, '@alice'),
        createElement('button', { key: 'act', type: 'button' }, 'Change'),
      ],
    });
    // One row with exactly two cells: field, then value.
    expect(host.children).toHaveLength(1);
    const row = host.firstElementChild as HTMLElement;
    expect(row.children).toHaveLength(2);
    const [field, value] = [...row.children] as HTMLElement[];
    expect(field!.textContent).toBe('Owner');
    // The value is the children as given — arbitrary JSX (a chip and an action), not only text.
    expect(value!.querySelector('[data-testid="chip"]')?.textContent).toBe('@alice');
    expect(value!.querySelector('button')?.textContent).toBe('Change');
    expect(field!.querySelector('[data-testid="chip"]')).toBeNull();
  });

  it('[entity:field-row] align="start" sets the row to align-items flex-start and drops the label by a 2 px padding-top to the first line of the value; default is center without it', () => {
    mount({ label: 'Description', children: 'line one\nline two\nline three', align: 'start' });
    const row = host.firstElementChild as HTMLElement;
    const labelCol = row.children[0] as HTMLElement;
    expect(row.style.alignItems).toBe('flex-start');
    expect(labelCol.style.paddingTop).toBe('2px');
    expect(labelCol.textContent).toBe('Description');
    // Default: center, the label is not lowered.
    mount({ label: 'Status', children: 'draft' });
    const centred = host.firstElementChild as HTMLElement;
    expect(centred.style.alignItems).toBe('center');
    expect((centred.children[0] as HTMLElement).style.paddingTop).not.toBe('2px');
  });
});
