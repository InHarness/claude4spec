import { beforeEach, describe, expect, it, vi } from 'vitest';

const reload = vi.hoisted(() => ({ calls: 0 }));
vi.mock('./project-reload.js', () => ({
  reloadProjectRoute: () => {
    reload.calls += 1;
  },
}));

import { useChatStore } from '../state/chat.js';
import { useGitOpsStore } from '../state/gitOps.js';
import { GIT_SHADOWS_KEY, GIT_STATUS_KEY, handleGitStatusChanged } from './git-ws.js';

/**
 * 2.1.64 (ASSUMPTION:dev-0008) — `git:status-changed { headChanged: true }`
 * naming a thread: the tab showing that thread does not reload under its own
 * turn (`run_remote` published its plan); any other tab does.
 */
describe('handleGitStatusChanged — the publishing thread', () => {
  const fire = (event: { headChanged: boolean; threadId?: string }) => {
    const keys: unknown[][] = [];
    handleGitStatusChanged(event, { queue: (k) => keys.push([...k]) });
    return keys;
  };

  beforeEach(() => {
    reload.calls = 0;
    useGitOpsStore.setState({ ops: [] });
    useChatStore.setState({ chatThreadId: 'thread-7' });
  });

  it('the tab showing the publishing thread refetches the git status and does not reload', () => {
    const keys = fire({ headChanged: true, threadId: 'thread-7' });
    expect(keys).toEqual([[...GIT_STATUS_KEY], [...GIT_SHADOWS_KEY]]);
    expect(reload.calls).toBe(0);
  });

  it('a tab showing another thread reloads', () => {
    fire({ headChanged: true, threadId: 'thread-8' });
    expect(reload.calls).toBe(1);
  });

  it('a tab with no thread open reloads', () => {
    useChatStore.setState({ chatThreadId: null });
    fire({ headChanged: true, threadId: 'thread-7' });
    expect(reload.calls).toBe(1);
  });

  it('the publishing thread claims no own operation: an own checkout still absorbs the next HEAD event', () => {
    useGitOpsStore.getState().begin('checkout');
    fire({ headChanged: true, threadId: 'thread-7' });
    expect(useGitOpsStore.getState().ops).toEqual([{ op: 'checkout', headSeen: false, answered: false }]);
  });

  it('an event without a thread keeps the M31 rule: another client moved HEAD → reload', () => {
    fire({ headChanged: true });
    expect(reload.calls).toBe(1);
  });
});
