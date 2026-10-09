/**
 * Places a suggestion popup (`@` mentions, `/` slash palette) next to the
 * caret rect. Shared so the two popups cannot drift apart again — the slash
 * palette used to open below the caret unconditionally and fell off the
 * bottom of the viewport in the chat composer.
 */
export function positionSuggestionPopup(popup: HTMLElement, rect: DOMRect): void {
  const popupH = popup.offsetHeight || 0;
  const popupW = popup.offsetWidth || 0;
  const margin = 6;
  const spaceBelow = window.innerHeight - rect.bottom;
  const spaceAbove = rect.top;
  // Flip above when there is not enough room below AND there is more room above.
  // Typical trigger in chat composer at the viewport bottom.
  const flipUp = popupH > 0 && spaceBelow < popupH + margin && spaceAbove > spaceBelow;
  const top = flipUp
    ? rect.top - margin - popupH + window.scrollY
    : rect.bottom + margin + window.scrollY;
  let left = rect.left + window.scrollX;
  if (popupW > 0 && left + popupW > window.innerWidth - 8) {
    left = Math.max(8, window.innerWidth - popupW - 8);
  }
  popup.style.top = `${top}px`;
  popup.style.left = `${left}px`;
}
