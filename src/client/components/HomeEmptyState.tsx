import { Plus } from 'lucide-react';
import { EmptyState } from '../host-ui-kit/list/EmptyState.js';
import { ActionButton } from '../host-ui-kit/actions/ActionButton.js';

/** Texts of the landing's empty-tree state (ui-view `home-redirect-empty-state`, step 5). */
export const HOME_EMPTY_TITLE = 'Welcome to claude4spec';
export const HOME_EMPTY_HINT =
  'Markdown is the source of truth for content, SQLite for entities, and XML tags are the bridge. Start by creating a page, or open an existing one from the sidebar.';
export const HOME_EMPTY_CTA = 'Create your first page';

interface Props {
  onNewPage: () => void;
}

/**
 * Route `/` with an empty page tree (M02 landing resolution `4dcvgivu`, step 5;
 * ui-view `home-redirect-empty-state`, 2.1.28): the catalog `EmptyState` with
 * the "Create your first page" CTA as a catalog `ActionButton` in its `action`
 * slot. A composition of catalog components only — the outer box just centres
 * the card in the pane; the 2.1.27 bespoke welcome card is gone.
 */
export function HomeEmptyState({ onNewPage }: Props) {
  return (
    <div className="flex-1 flex items-center justify-center px-10" data-testid="home-empty-state">
      <div className="w-full max-w-md">
        <EmptyState
          title={HOME_EMPTY_TITLE}
          hint={HOME_EMPTY_HINT}
          action={
            <ActionButton
              variant="primary"
              icon={<Plus size={12} />}
              label={HOME_EMPTY_CTA}
              onClick={onNewPage}
            />
          }
        />
      </div>
    </div>
  );
}
