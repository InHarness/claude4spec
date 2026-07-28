import { describe, expect, it } from 'vitest';
import { changedByBadgeStyle } from './VersionHistory.js';

describe('changedByBadgeStyle (M13/M34)', () => {
  it('[ac:ac-badge-changedby-w-widoku-historii-ent] gives agent and user visually distinct colours', () => {
    const agent = changedByBadgeStyle('agent');
    const user = changedByBadgeStyle('user');

    // A shared colour would make the badge text the ONLY signal — the whole
    // point of the badge is that the difference reads at a glance.
    expect(agent.bg).not.toBe(user.bg);
    expect(agent.fg).not.toBe(user.fg);
  });

  it('falls back to a neutral colour for filesystem-authored versions', () => {
    const fs = changedByBadgeStyle('filesystem');
    expect(fs.bg).not.toBe(changedByBadgeStyle('agent').bg);
    expect(fs.bg).not.toBe(changedByBadgeStyle('user').bg);
  });
});
