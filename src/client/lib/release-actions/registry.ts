import type { ReactNode } from 'react';
import type { ReleaseDetail } from '../../../shared/entities.js';

/**
 * Actions registry — extension points (m17uidet01).
 * Wzorzec analogiczny do plugin host registry M13: future moduły
 * (M18 Briefs "Generate brief", M19 Cloud "Publish", ...) dorabiają
 * własną akcję jako wpis w tym registry zamiast modyfikować ReleaseDetail.
 */

export interface ReleaseActionContext {
  release: ReleaseDetail;
  /** Close the host menu/dropdown the action is rendered in (optional). */
  onClose?: () => void;
}

export interface ReleaseAction {
  id: string;
  /** Etykieta wyświetlana userowi. */
  label: string;
  /** Opcjonalna krótka pomocnicza notatka pod buttonem (lub w tooltipie). */
  hint?: string;
  /** Render pełnego elementu klikalnego (button/link); akcja sama decyduje o wyglądzie. */
  render: (ctx: ReleaseActionContext) => ReactNode;
}

const actions: ReleaseAction[] = [];

export function registerReleaseAction(action: ReleaseAction): void {
  if (actions.some((a) => a.id === action.id)) return;
  actions.push(action);
}

export function listReleaseActions(): ReleaseAction[] {
  return [...actions];
}
