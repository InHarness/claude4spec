import { toast } from '../../../ui/events.js';

interface WidgetArgs {
  anchor: string | null;
  pagePath: string;
}

const SVG_ATTRS =
  'xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" ' +
  'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

const LINK_SVG = `<svg ${SVG_ATTRS}>` +
  '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>' +
  '<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>' +
  '</svg>';

const HASH_SVG = `<svg ${SVG_ATTRS}>` +
  '<line x1="4" x2="20" y1="9" y2="9"/>' +
  '<line x1="4" x2="20" y1="15" y2="15"/>' +
  '<line x1="10" x2="8" y1="3" y2="21"/>' +
  '<line x1="16" x2="14" y1="3" y2="21"/>' +
  '</svg>';

export function createHeadingActionsWidget({ anchor, pagePath }: WidgetArgs): HTMLElement {
  const wrap = document.createElement('span');
  wrap.className = 'heading-actions';
  wrap.setAttribute('contenteditable', 'false');
  wrap.setAttribute('data-anchor', anchor ?? 'pending');

  const linkTitle = anchor ? 'Copy link to section' : 'Anchor pending — save first';
  const refTitle = anchor ? 'Copy as <section_ref/>' : 'Anchor pending — save first';

  const linkBtn = makeButton(LINK_SVG, linkTitle, !anchor);
  const refBtn = makeButton(HASH_SVG, refTitle, !anchor);

  if (anchor) {
    linkBtn.addEventListener('mousedown', (e) => e.preventDefault());
    refBtn.addEventListener('mousedown', (e) => e.preventDefault());
    linkBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const url = `${window.location.origin}/pages/${pagePath}#anchor-${anchor}`;
      void navigator.clipboard
        .writeText(url)
        .then(() => toast.success('Link copied'))
        .catch(() => toast.error('Failed to copy link'));
      syncHashAndScroll(anchor);
    });
    refBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const xml = `<section_ref anchor="${anchor}"/>`;
      void navigator.clipboard
        .writeText(xml)
        .then(() => toast.success('Copied as <section_ref/>'))
        .catch(() => toast.error('Failed to copy reference'));
      syncHashAndScroll(anchor);
    });
  }

  wrap.append(linkBtn, refBtn);
  return wrap;
}

function syncHashAndScroll(anchor: string): void {
  const target = `#anchor-${anchor}`;
  if (window.location.hash !== target) {
    history.replaceState(null, '', target);
  }
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

function makeButton(svg: string, title: string, disabled: boolean): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'heading-actions__btn' + (disabled ? ' heading-actions__btn--disabled' : '');
  b.title = title;
  b.setAttribute('aria-label', title);
  if (disabled) b.disabled = true;
  b.innerHTML = svg;
  return b;
}
