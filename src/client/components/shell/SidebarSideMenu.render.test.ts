// @vitest-environment happy-dom
/**
 * M50 `8h2a734u` / `l5pkeysm` — the sidebar side menu, rendered for real under a
 * real (memory-history) TanStack router: its items are the router's `Link`s, so
 * a click navigates exactly as in the app and a modifier click is left to the
 * browser.
 *
 * Two menus share the page, as OTHERS and an ELEMENTS entry do in the sidebar.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, createElement, Fragment } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { ClipboardList, GitCommit, Tag } from 'lucide-react';
import { SIDE_MENU_PREVIEW_DELAY_MS, SidebarSideMenu, type SideMenuItem } from './SidebarSideMenu.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MENU_A: SideMenuItem[] = [
  { to: '/plans', icon: ClipboardList, label: 'Plans' },
  { to: '/releases', icon: GitCommit, label: 'Releases' },
];
const MENU_B: SideMenuItem[] = [{ to: '/tags', icon: Tag, label: 'Tags' }];

function Shell() {
  return createElement(
    Fragment,
    null,
    createElement(SidebarSideMenu, { label: 'Menu A', items: MENU_A, children: 'Entry A' }),
    createElement(SidebarSideMenu, { label: 'Menu B', items: MENU_B, children: 'Entry B' }),
    createElement('a', { 'data-testid': 'plain-entry', href: '/' }, 'Plain entry'),
    createElement('button', { 'data-testid': 'elsewhere' }, 'elsewhere'),
    createElement('input', { 'data-testid': 'field' }),
    createElement(Outlet),
  );
}

function makeRouter() {
  const rootRoute = createRootRoute({ component: Shell });
  const page = (path: string) =>
    createRoute({ getParentRoute: () => rootRoute, path, component: () => createElement('p', null, path) });
  return createRouter({
    routeTree: rootRoute.addChildren([page('/'), page('/plans'), page('/releases'), page('/tags')]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
}

let host: HTMLDivElement;
let root: Root;
let router: ReturnType<typeof makeRouter>;
/** Whether the app left the last click's default action to the browser. */
let lastClickLeftToBrowser: boolean | null;
/**
 * Registered on `document`, i.e. after React's and the router's handlers: it
 * records what they did with the click, then stops happy-dom from performing an
 * anchor's default action (a document navigation) itself.
 */
const clickGuard = (e: Event) => {
  lastClickLeftToBrowser = !e.defaultPrevented;
  e.preventDefault();
};

async function flush() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

const trigger = (text: string) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="menu"]')).find(
    (b) => b.textContent === text,
  )!;
const openMenus = () =>
  Array.from(host.querySelectorAll('[role="menu"]')).map((m) => m.getAttribute('aria-label'));
const item = (label: string) =>
  Array.from(host.querySelectorAll<HTMLElement>('[role="menuitem"]')).find((a) => a.textContent === label)!;

async function click(el: Element, init: MouseEventInit = {}) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init }));
  });
  await flush();
}

/** A real click on the entry, which also focuses it as a browser does. */
async function openByClick(text: string) {
  const t = trigger(text);
  act(() => t.focus());
  await click(t);
}

/** Where the (mouse) pointer currently is — moves dispatch out/over pairs as a browser does. */
let pointerAt: Element = document.body;

/** Moves a pointer onto `el` (React derives enter/leave from these out/over pairs). */
async function pointTo(el: Element, pointerType = 'mouse') {
  const from = pointerAt;
  pointerAt = el;
  await act(async () => {
    from.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, relatedTarget: el, pointerType }));
    el.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, relatedTarget: from, pointerType }));
  });
}

const hover = (el: Element) => pointTo(el);
/** The open menu's panel — the Popover around the list. */
const panel = () => host.querySelector('[role="menu"]')!.closest('[role="dialog"]')!;
const elsewhere = () => host.querySelector<HTMLElement>('[data-testid="elsewhere"]')!;
const plainEntry = () => host.querySelector<HTMLElement>('[data-testid="plain-entry"]')!;

/** Lets `ms` of real time pass (the preview delay is a real timer). */
async function wait(ms: number) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}
const pastDelay = () => wait(SIDE_MENU_PREVIEW_DELAY_MS + 60);
const withinDelay = () => wait(SIDE_MENU_PREVIEW_DELAY_MS / 4);

/** Whether the device reports a hover-capable primary pointer (`(hover: hover)`). */
let deviceCanHover = true;
const realMatchMedia = window.matchMedia;

/** Presses a key on the focused element; returns whether the app prevented its default. */
async function key(k: string, shiftKey = false): Promise<boolean> {
  const target = (document.activeElement as HTMLElement | null) ?? document.body;
  const ev = new KeyboardEvent('keydown', { key: k, shiftKey, bubbles: true, cancelable: true });
  await act(async () => {
    target.dispatchEvent(ev);
  });
  await flush();
  return ev.defaultPrevented;
}

beforeEach(async () => {
  lastClickLeftToBrowser = null;
  pointerAt = document.body;
  deviceCanHover = true;
  window.matchMedia = ((query: string) => ({
    matches: query === '(hover: hover)' ? deviceCanHover : false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  document.addEventListener('click', clickGuard);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  router = makeRouter();
  await act(async () => {
    await router.load();
  });
  await act(async () => {
    root.render(createElement(RouterProvider, { router } as never));
  });
  await flush();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.removeEventListener('click', clickGuard);
  window.matchMedia = realMatchMedia;
});

describe('sidebar side menu (M50 8h2a734u)', () => {
  it('[section:8h2a734u] the entry announces aria-haspopup/aria-expanded, the open list is a role="menu" of menuitem links anchored in the kit Popover', async () => {
    const a = trigger('Entry A');
    expect(a.getAttribute('aria-haspopup')).toBe('menu');
    expect(a.getAttribute('aria-expanded')).toBe('false');
    expect(openMenus()).toEqual([]);

    await click(a);
    expect(a.getAttribute('aria-expanded')).toBe('true');
    const menu = host.querySelector('[role="menu"]')!;
    expect(menu.getAttribute('aria-label')).toBe('Menu A');
    expect(a.getAttribute('aria-controls')).toBe(menu.id);
    // Items are links (real anchors with the route's href), in the given order.
    const items = Array.from(menu.querySelectorAll('[role="menuitem"]'));
    expect(items.map((i) => i.tagName)).toEqual(['A', 'A']);
    expect(items.map((i) => i.textContent)).toEqual(['Plans', 'Releases']);
    expect(items.map((i) => new URL((i as HTMLAnchorElement).href).pathname)).toEqual(['/plans', '/releases']);
    // The panel is the catalog Popover (its fixed, popover-tier shell).
    expect((menu.closest('[role="dialog"]') as HTMLElement).style.position).toBe('fixed');
  });

  it('[ac:ac-otwarcie-menu-bocznego-sidebara-zamyk] opening a side menu — by click or by hover — closes the other open side menu', async () => {
    await click(trigger('Entry A'));
    expect(openMenus()).toEqual(['Menu A']);

    // Click opens B; A closes.
    await click(trigger('Entry B'));
    expect(openMenus()).toEqual(['Menu B']);
    expect(trigger('Entry A').getAttribute('aria-expanded')).toBe('false');
    expect(trigger('Entry B').getAttribute('aria-expanded')).toBe('true');

    // A hover opens A once nothing is pinned; hovering B then previews B, A closes.
    await key('Escape');
    await hover(trigger('Entry A'));
    expect(openMenus()).toEqual(['Menu A']);
    await hover(trigger('Entry B'));
    await pastDelay();
    expect(openMenus()).toEqual(['Menu B']);
    expect(trigger('Entry A').getAttribute('aria-expanded')).toBe('false');
  });

  it('[ac:ac-klik-pozycji-menu-bocznego-sidebara-n] a click on a side-menu item navigates to that item\'s route', async () => {
    expect(router.state.location.pathname).toBe('/');
    await click(trigger('Entry A'));
    await click(item('Releases'));
    expect(router.state.location.pathname).toBe('/releases');
    // The router handled it in-app, not as a document load.
    expect(lastClickLeftToBrowser).toBe(false);
    expect(host.textContent).toContain('/releases');
  });

  it('[ac:ac-klik-pozycji-menu-bocznego-sidebara-z] a click on a side-menu item closes the menu', async () => {
    await click(trigger('Entry A'));
    expect(openMenus()).toEqual(['Menu A']);
    await click(item('Plans'));
    expect(openMenus()).toEqual([]);
    expect(trigger('Entry A').getAttribute('aria-expanded')).toBe('false');
  });

  it('[ac:ac-cmd-ctrl-klik-pozycji-menu-bocznego-o] Cmd/Ctrl+click on a side-menu item leaves the link to the browser — a new tab on the item\'s route — and this tab stays put', async () => {
    await click(trigger('Entry A'));
    const releases = item('Releases') as HTMLAnchorElement;
    // The browser opens THIS href in the new tab: the item's route, same window target.
    expect(new URL(releases.href).pathname).toBe('/releases');
    expect(releases.getAttribute('target')).toBeNull();

    for (const mod of [{ metaKey: true }, { ctrlKey: true }]) {
      lastClickLeftToBrowser = null;
      await click(item('Releases'), mod);
      // Nobody prevented the default action, so the browser's new-tab handling runs…
      expect(lastClickLeftToBrowser).toBe(true);
      // …while the app did not navigate in this tab, and the menu stays open.
      expect(router.state.location.pathname).toBe('/');
      expect(openMenus()).toEqual(['Menu A']);
    }
  });

  it('[ac:ac-esc-zamyka-otwarte-menu-boczne-sideba] Esc closes the open side menu', async () => {
    await openByClick('Entry B');
    expect(openMenus()).toEqual(['Menu B']);
    await key('Escape');
    expect(openMenus()).toEqual([]);
    expect(trigger('Entry B').getAttribute('aria-expanded')).toBe('false');
  });

  it('[ac:ac-po-zamknieciu-menu-bocznego-klawiszem] after Esc closes the side menu, focus is back on the entry that opened it', async () => {
    const elsewhere = host.querySelector<HTMLButtonElement>('[data-testid="elsewhere"]')!;
    act(() => elsewhere.focus());
    await openByClick('Entry A');
    // ↓ moves the highlight — and focus — into the menu.
    await key('ArrowDown');
    expect(document.activeElement).toBe(item('Plans'));

    await key('Escape');
    expect(openMenus()).toEqual([]);
    expect(document.activeElement).toBe(trigger('Entry A'));
  });

  it('[section:l5pkeysm] side-menu keys: ↑/↓ move the highlight, Enter goes to the highlighted item, Tab and Shift+Tab close', async () => {
    await openByClick('Entry A');
    await key('ArrowDown');
    await key('ArrowDown');
    expect(document.activeElement).toBe(item('Releases'));
    await key('ArrowDown'); // wraps
    expect(document.activeElement).toBe(item('Plans'));
    await key('ArrowUp'); // wraps back
    expect(document.activeElement).toBe(item('Releases'));

    // Enter with focus back on the entry goes to the highlighted item.
    act(() => trigger('Entry A').focus());
    await key('Enter');
    expect(router.state.location.pathname).toBe('/releases');
    expect(openMenus()).toEqual([]);

    await openByClick('Entry A');
    await key('Tab');
    expect(openMenus()).toEqual([]);

    await openByClick('Entry A');
    await key('Tab', true);
    expect(openMenus()).toEqual([]);

    // Tab from an item: focus is handed back to the entry before the list
    // unmounts, so the browser's Tab continues from next to the entry.
    await openByClick('Entry A');
    await key('ArrowDown');
    expect(document.activeElement).toBe(item('Plans'));
    await key('Tab');
    expect(openMenus()).toEqual([]);
    expect(document.activeElement).toBe(trigger('Entry A'));
  });

  it('[section:l5pkeysm] a hover-opened menu leaves the keys of the focused field alone — only focus on the entry or in the list drives the menu', async () => {
    const field = host.querySelector<HTMLInputElement>('[data-testid="field"]')!;
    act(() => field.focus());
    await hover(trigger('Entry A'));
    expect(openMenus()).toEqual(['Menu A']);

    // ↑/↓/Enter stay the field's: not prevented, focus not pulled into the menu, no navigation.
    expect(await key('ArrowDown')).toBe(false);
    expect(await key('ArrowUp')).toBe(false);
    expect(document.activeElement).toBe(field);
    expect(await key('Enter')).toBe(false);
    expect(router.state.location.pathname).toBe('/');
    // Tab in the field does not touch the menu either.
    await key('Tab');
    expect(document.activeElement).toBe(field);
    expect(openMenus()).toEqual(['Menu A']);

    // Esc closes it (the Popover's own close) without moving focus to the entry.
    await key('Escape');
    expect(openMenus()).toEqual([]);
    expect(document.activeElement).toBe(field);
  });

  it('[section:8h2a734u] click-outside closes the menu; a click on the entry of a hover-opened menu keeps it open, a second one closes it', async () => {
    await hover(trigger('Entry A'));
    expect(openMenus()).toEqual(['Menu A']);
    await click(trigger('Entry A'));
    expect(openMenus()).toEqual(['Menu A']);
    await click(trigger('Entry A'));
    expect(openMenus()).toEqual([]);

    await click(trigger('Entry A'));
    await act(async () => {
      host
        .querySelector('[data-testid="elsewhere"]')!
        .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(openMenus()).toEqual([]);
  });
});

describe('sidebar side menu — preview (hover) vs pinned (click) (M50 8h2a734u)', () => {
  it('[ac:ac-menu-boczne-sidebara-otwarte-najechan] a hover-opened side menu closes after the delay once the pointer is outside the entry and the panel', async () => {
    await hover(trigger('Entry A'));
    expect(openMenus()).toEqual(['Menu A']);
    await hover(elsewhere());
    // Not at once — only after the delay.
    await withinDelay();
    expect(openMenus()).toEqual(['Menu A']);
    await pastDelay();
    expect(openMenus()).toEqual([]);
  });

  it('[ac:ac-powrot-wskaznika-na-wpis-lub-panel-pr] coming back to the entry or the panel before the delay cancels the close of a hover-opened menu', async () => {
    await hover(trigger('Entry A'));
    await hover(elsewhere());
    await withinDelay();
    await hover(trigger('Entry A'));
    await pastDelay();
    expect(openMenus()).toEqual(['Menu A']);

    await hover(elsewhere());
    await withinDelay();
    await hover(item('Plans'));
    await pastDelay();
    expect(openMenus()).toEqual(['Menu A']);
  });

  it('[ac:ac-przejscie-wskaznika-z-wpisu-na-panel] moving the pointer from the entry onto the panel keeps a hover-opened menu', async () => {
    await hover(trigger('Entry A'));
    // The Popover's padding is the panel too, not only the list.
    await hover(panel());
    await hover(item('Releases'));
    await pastDelay();
    expect(openMenus()).toEqual(['Menu A']);
  });

  it('[ac:ac-po-kliku-wpisu-ktorego-menu-boczne-je] after a click on the entry of a hover-opened menu, it stays open once the pointer leaves', async () => {
    await hover(trigger('Entry A'));
    await click(trigger('Entry A'));
    await hover(elsewhere());
    await pastDelay();
    expect(openMenus()).toEqual(['Menu A']);
  });

  it('[ac:ac-menu-boczne-sidebara-otwarte-klikiem] a click-opened side menu stays open when the pointer leaves the entry and the panel', async () => {
    await click(trigger('Entry A'));
    await hover(panel());
    await hover(elsewhere());
    await pastDelay();
    expect(openMenus()).toEqual(['Menu A']);
  });

  it('[ac:ac-klik-wpisu-ktorego-menu-boczne-jest-p] a click on the entry of a pinned side menu closes it', async () => {
    await click(trigger('Entry A'));
    expect(openMenus()).toEqual(['Menu A']);
    await click(trigger('Entry A'));
    expect(openMenus()).toEqual([]);
    expect(trigger('Entry A').getAttribute('aria-expanded')).toBe('false');
  });

  it('[ac:ac-po-wejsciu-focusu-do-panelu-menu-bocz] after focus enters the panel of a hover-opened menu, it stays open once the pointer leaves', async () => {
    await hover(trigger('Entry A'));
    act(() => item('Plans').focus());
    await hover(elsewhere());
    await pastDelay();
    expect(openMenus()).toEqual(['Menu A']);
  });

  it('[ac:ac-na-urzadzeniu-bez-najechania-menu-boc] on a device without hover the side menu opens only by a click', async () => {
    // A touch pointer never previews…
    await pointTo(trigger('Entry A'), 'touch');
    expect(openMenus()).toEqual([]);
    // …nor does a mouse-typed event on a device whose media says it cannot hover.
    deviceCanHover = false;
    await pointTo(elsewhere());
    await pointTo(trigger('Entry A'));
    expect(openMenus()).toEqual([]);
    // A click opens it — pinned at once.
    await click(trigger('Entry A'));
    await pointTo(elsewhere());
    await pastDelay();
    expect(openMenus()).toEqual(['Menu A']);
  });

  it('[ac:ac-wpis-wyzwalacz-oglasza-stan-rozwiniec] the entry announces the expanded state the same for a hover-opened and a click-opened menu', async () => {
    const a = trigger('Entry A');
    await hover(a);
    const previewed = [a.getAttribute('aria-expanded'), a.getAttribute('aria-controls')];
    await click(a);
    const pinned = [a.getAttribute('aria-expanded'), a.getAttribute('aria-controls')];
    expect(previewed[0]).toBe('true');
    expect(pinned).toEqual(previewed);
  });

  it('[ac:ac-wskaznik-przecinajacy-sasiedni-wpis-w] a pointer crossing a neighbouring entry on its way to the panel keeps the hover-opened menu', async () => {
    await hover(trigger('Entry A'));
    await hover(trigger('Entry B'));
    await withinDelay();
    await hover(panel());
    await pastDelay();
    expect(openMenus()).toEqual(['Menu A']);
    // Resting on the neighbour past the delay swaps the preview to it.
    await hover(trigger('Entry B'));
    await pastDelay();
    expect(openMenus()).toEqual(['Menu B']);
  });

  it('[ac:ac-najechanie-wpisu-sidebara-ktory-nie-o] hovering a sidebar entry that opens no menu closes a hover-opened menu after the delay', async () => {
    await hover(trigger('Entry A'));
    await hover(plainEntry());
    await withinDelay();
    expect(openMenus()).toEqual(['Menu A']);
    await pastDelay();
    expect(openMenus()).toEqual([]);
  });

  it('[ac:ac-najechanie-innego-wpisu-przy-menu-boc] hovering another entry while a side menu is pinned neither closes it nor previews the other', async () => {
    await click(trigger('Entry A'));
    await hover(trigger('Entry B'));
    await pastDelay();
    expect(openMenus()).toEqual(['Menu A']);
    expect(trigger('Entry B').getAttribute('aria-expanded')).toBe('false');
    // Only a click opens another one.
    await click(trigger('Entry B'));
    expect(openMenus()).toEqual(['Menu B']);
  });
});
