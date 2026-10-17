// @vitest-environment happy-dom
/**
 * M34/L12 — `FormShell` (group `overlay`, `experimental`) against its
 * `ui-kit-component` record `form-shell` (2.1.28): a form container the
 * consumer fills with `FormField` / `InlineEditField`; it owns no mutation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FormEvent } from 'react';
import { FormShell, type FormShellProps } from './FormShell.js';
import { FormField } from '../form/FormField.js';
import { InlineEditField } from '../form/InlineEditField.js';
import { UI_KIT_CATALOG, UI_KIT_STABLE_COMPONENTS } from '../registry.js';
import * as uiBrowserSurface from '../index.js';
import { UI_KIT_STABLE_COMPONENTS as BACKEND_STABLE } from '../../../shared/plugin-host/ui-kit-surface.js';
import { VERSIONED_UI_KIT_COMPONENTS, recordedUiKitStableComponents } from '../../../shared/plugin-host/host-api.js';
import type * as Published from '../../../plugin-types/ui.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Mutual assignability + the same key set: the record's prop list, no more, no less. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? ([keyof A] extends [keyof B] ? ([keyof B] extends [keyof A] ? true : false) : false) : false) : false;

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
  vi.restoreAllMocks();
});

const mount = (el: ReactNode) => act(() => root.render(el));

interface RecordFormShellProps {
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  children: ReactNode;
  actions?: ReactNode;
  busy?: boolean;
  error?: ReactNode;
}

// Resolved with node:path from the module's own file path — under happy-dom the global `URL`
// is the window's, so `new URL(rel, import.meta.url)` is not a `file:` URL that `fileURLToPath`
// accepts (same pattern as tokens.render.test.ts).
const HERE = dirname(fileURLToPath(import.meta.url));

const code = (rel: string) =>
  readFileSync(resolve(HERE, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

function shell(over: Partial<FormShellProps> = {}) {
  const props: FormShellProps = {
    onSubmit: (e) => e.preventDefault(),
    children: [
      createElement(FormField, { key: 'f', label: 'Slug', children: createElement('input', { 'data-testid': 'slug' }) }),
      createElement(InlineEditField, { key: 'i', value: 'Users', onCommit: () => {} }),
    ],
    ...over,
  };
  mount(createElement(FormShell, props));
}

describe('FormShell ↔ record `form-shell` (M34/L12, 2.1.28)', () => {
  it('[entity:form-shell] takes exactly the record props (host and published /ui alike)', () => {
    const a: Same<FormShellProps, RecordFormShellProps> = true;
    const b: Same<Published.FormShellProps, RecordFormShellProps> = true;
    expect([a, b]).toEqual([true, true]);
  });

  it('[entity:form-shell] renders a form with the fields, the error under them and the actions row', () => {
    shell({ error: 'Slug taken', actions: createElement('button', { type: 'submit' }, 'Save') });
    const form = host.querySelector('form')!;
    const fieldset = form.querySelector('fieldset')!;
    const [fields, error, actions] = Array.from(fieldset.children);
    expect(fields!.querySelector('[data-testid="slug"]')).not.toBeNull();
    expect(error!.textContent).toBe('Slug taken');
    expect(actions!.textContent).toBe('Save');
  });
});

describe('FormShell — fields as children, busy, error, author onSubmit (M34/L12)', () => {
  it('[ac:ac-formshell-komponuje-atomy-formfield-inli] takes FormField / InlineEditField atoms as children, as given — it composes no field itself', () => {
    shell();
    const fields = host.querySelector('fieldset')!.firstElementChild!;
    expect(fields.textContent).toContain('Slug');
    expect(fields.querySelector('[data-testid="slug"]')).not.toBeNull();
    expect(fields.textContent).toContain('Users');
    // The shell module imports no field atom: what renders is what the consumer put in.
    const src = code('./FormShell.tsx');
    expect(src).not.toMatch(/import[^;]*\b(FormField|InlineEditField)\b/);
  });

  it('[ac:ac-formshell-komponuje-atomy-formfield-inli] propagates busy to the fields (disabled fieldset around them)', () => {
    shell({ busy: true });
    const fieldset = host.querySelector('fieldset')!;
    expect(fieldset.disabled).toBe(true);
    expect(fieldset.contains(host.querySelector('[data-testid="slug"]'))).toBe(true);
    shell({ busy: false });
    expect(host.querySelector('fieldset')!.disabled).toBe(false);
  });

  it('[ac:ac-formshell-komponuje-atomy-formfield-inli] propagates error as a message below the fields', () => {
    shell({ error: 'Could not create' });
    const fieldset = host.querySelector('fieldset')!;
    expect(fieldset.children[1]!.textContent).toBe('Could not create');
    shell();
    expect(host.querySelector('fieldset')!.children).toHaveLength(1);
  });

  it('[ac:ac-formshell-komponuje-atomy-formfield-inli] onSubmit is the author\'s callback — the shell performs no mutation', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const onSubmit = vi.fn((e: FormEvent<HTMLFormElement>) => e.preventDefault());
    shell({ onSubmit });
    act(() => {
      host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    const src = code('./FormShell.tsx');
    expect(src).not.toMatch(/useMutation|useQuery|queryClient|fetch\(|apiFetch|@tanstack/);
  });
});

describe('Dialog and FormShell — the experimental tier (M34/L12)', () => {
  it('[ac:ac-dialog-i-formshell-sa-w-tierze-experimen] both are experimental entries shipped by @c4s/plugin-runtime/ui (runtime and published types)', () => {
    for (const name of ['Dialog', 'FormShell']) {
      expect(UI_KIT_CATALOG.find((c) => c.name === name)?.stability, name).toBe('experimental');
      expect(typeof (uiBrowserSurface as Record<string, unknown>)[name], name).toBe('function');
    }
    const published = readFileSync(resolve(HERE, '../../../plugin-types/ui.ts'), 'utf8');
    expect(published).toMatch(/export declare const Dialog: /);
    expect(published).toMatch(/export declare const FormShell: /);
  });

  it('[ac:ac-dialog-i-formshell-sa-w-tierze-experimen] both stay outside hostApiVersion: not on the stable list either /ui leg carries, not in the versioned surface or any recorded release', () => {
    for (const name of ['Dialog', 'FormShell']) {
      expect(UI_KIT_STABLE_COMPONENTS, name).not.toContain(name);
      expect([...BACKEND_STABLE] as string[], name).not.toContain(name);
      expect([...VERSIONED_UI_KIT_COMPONENTS] as string[], name).not.toContain(name);
      expect(recordedUiKitStableComponents(), name).not.toContain(name);
    }
  });
});
