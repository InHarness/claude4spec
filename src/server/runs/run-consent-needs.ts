import { hasProjectPlugins } from '../core/plugin-host/overlay-loader.js';
import { readPeerSkillConfig } from '../workspace/peer-config.js';
import type { RunConsentNeeds } from './run-remote.js';

/**
 * M55 `jlgucjnq`: what a project directory asks a local consent for — its
 * local plugin packages (`.claude4spec/plugins/`) and its `skill.uses` names.
 * Kept apart from `run-remote.ts` so the operation's module stays free of the
 * plugin loader. 2.1.69: read from the project's directory on this machine —
 * the same reads that drive the local trust prompt (M01 `dsh8ezbz`).
 */
export function runConsentNeedsOf(cwd: string | null): RunConsentNeeds {
  if (cwd === null) return { plugins: false, skillUses: [] };
  return { plugins: hasProjectPlugins(cwd), skillUses: readPeerSkillConfig(cwd)?.uses ?? [] };
}
