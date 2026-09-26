import type { ComponentType } from 'react';
import type { ModalFormProps } from '../ModalHost.js';
import type { ModalKind } from '../events.js';
import { ToolJsonView } from './ToolJsonView.js';
import { GitSyncRecover } from './GitSyncRecover.js';
import { PageChanged } from './PageChanged.js';
import { ChoiceModal } from './ChoiceModal.js';
import { ProjectCreate } from './ProjectCreate.js';
import { TrustPluginsModal } from '../../components/TrustPluginsModal.js';

type HostModalKind = Exclude<ModalKind, `${string}-expand`>;

type RendererMap = { [K in HostModalKind]?: ComponentType<ModalFormProps<K>> };

/**
 * 0.2.110 M50 — the host's modal windows by `kind`. Each renderer draws its own
 * catalog `Dialog` (or a declared-exception panel) and answers through
 * `onClose(result | null)`. `<type>-expand` kinds are not listed: `ModalHost`
 * resolves them off the entity type's `renderOverlay` slot.
 */
export const MODAL_RENDERERS: RendererMap = {
  'tool-json-view': ToolJsonView,
  'git-sync-recover': GitSyncRecover,
  'page-resolve': PageChanged,
  'page-reload': PageChanged,
  'onboarding-skip': ChoiceModal,
  'release-push': ChoiceModal,
  'project-create': ProjectCreate,
  'project-plugins-trust': TrustPluginsModal,
};
