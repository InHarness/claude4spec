import { SUPPORTED_LANGUAGES, isSupportedLanguage } from '../../shared/languages.js';
import type { FieldDeclaration } from '../settings/field-registry.js';

/**
 * 0.2.113 — the `agent.*` leaves, declared by the chat-agent module.
 *
 * The split that matters is the effect class:
 *  - `claudeUsePreset` is `per-turn` — the next turn picks it up, ongoing threads included;
 *  - `conversationalLanguage` is `new-thread`;
 *  - the path scope (`allowedPaths` / `disallowedPaths`) and the filesystem posture
 *    are `new-thread` AND resume-locked: they enter the turn-1 snapshot and a thread
 *    founded under other values cannot be resumed (`409 RESUME_CONFIG_LOCKED`).
 *
 * The Anthropic API key is NOT a config field: it lives in `agent_credential` behind
 * `/api/agent/credentials` and is read per turn, never snapshotted.
 */
export const AGENT_SETTINGS_FIELDS: FieldDeclaration[] = [
  {
    key: 'agent.claudeUsePreset',
    owner: 'agent-chat',
    type: 'boolean',
    default: false,
    effect: 'per-turn',
    resumeLock: false,
    apiWritable: true,
  },
  {
    key: 'agent.conversationalLanguage',
    owner: 'agent-chat',
    type: 'string|null',
    default: null,
    validate: (value) =>
      value !== null && !isSupportedLanguage(value)
        ? {
            ok: false,
            error: `agent.conversationalLanguage "${String(value)}" not supported. Available: ${SUPPORTED_LANGUAGES.join(', ')}`,
          }
        : { ok: true },
    effect: 'new-thread',
    resumeLock: false,
    apiWritable: true,
  },
  {
    key: 'agent.allowedPaths',
    owner: 'agent-chat',
    type: 'string[]',
    default: [],
    effect: 'new-thread',
    resumeLock: true,
    apiWritable: true,
  },
  {
    key: 'agent.disallowedPaths',
    owner: 'agent-chat',
    type: 'string[]',
    default: [],
    effect: 'new-thread',
    resumeLock: true,
    apiWritable: true,
  },
  {
    key: 'agent.disableDirectFilesystemAccess',
    owner: 'agent-chat',
    type: 'boolean',
    default: true,
    effect: 'new-thread',
    resumeLock: true,
    apiWritable: true,
  },
];
