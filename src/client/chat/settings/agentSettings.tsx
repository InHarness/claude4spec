import { useState } from 'react';
import {
  useAgentCredentials,
  useSetAgentCredential,
  useRemoveAgentCredential,
} from '../../hooks/useAgentCredentials.js';
import { ApiError } from '../../lib/api.js';
import { confirmDestructive, toast } from '../../ui/events.js';
import { SUPPORTED_LANGUAGES } from '../../../shared/languages.js';
import { inputStyle } from '../../components/settings/controls.js';
import { EFFECT, type ElementContext, type SettingsContribution } from '../../components/settings/registry.js';

const BLOCK_KEY = ['agent', 'disableDirectFilesystemAccess'] as const;

/** The draft value of "Block direct file access" — absent means ON (server default). */
const blockDirectFs = ({ draft }: ElementContext) => (draft.get(BLOCK_KEY) as boolean | undefined) ?? true;

/**
 * 0.2.113 — the chat-agent module's card. The agent's tool posture has NO control
 * in the chat UI (not by the composer, not in `ModelSettingsPopover`): this card
 * is the one place it changes, because a policy fixed for a whole conversation
 * has no business next to a box that starts a turn.
 */
export const AGENT_SETTINGS: SettingsContribution = {
  cards: [
    {
      anchor: 'agent',
      title: 'Agent',
      description: 'How the chat agent works in this project.',
      group: 'Agent',
      weight: 10,
      owner: 'agent-chat',
    },
  ],
  elements: [
    {
      id: 'conversational-language',
      card: 'agent',
      weight: 20,
      kind: 'select',
      owner: 'agent-chat',
      configKey: ['agent', 'conversationalLanguage'],
      label: 'Conversational language',
      nullOption: 'None',
      help: 'The agent replies in this language whatever you write in. Not the spec language — set that on the Project card.',
      effectMessage: EFFECT.newThread,
      useOptions: () => SUPPORTED_LANGUAGES.map((l) => ({ value: l, label: l })),
    },
    {
      id: 'block-direct-file-access',
      card: 'agent',
      weight: 30,
      kind: 'toggle',
      owner: 'agent-chat',
      configKey: [...BLOCK_KEY],
      baseline: (config) => config.agent?.disableDirectFilesystemAccess ?? true,
      label: 'Block direct file access',
      help: (
        <>
          Checked (default): the agent reads and changes the specification through core operations only — it has no
          file or shell tools. Uncheck only if the agent should work on files outside the specification (code,
          implementation artifacts). Changing it ends the ability to resume existing conversations — they will need
          to be started anew.
          <span className="block mt-1">
            Unavailable while checked: git recovery (“Fix it with Agent” in the git error dialog), the c4s CLI the agent
            runs from a shell, and scaffolding a new writing style into .claude/skills/.
          </span>
        </>
      ),
      effectMessage: EFFECT.resumeBreak,
    },
    {
      id: 'claude-use-preset',
      card: 'agent',
      weight: 40,
      kind: 'toggle',
      owner: 'agent-chat',
      configKey: ['agent', 'claudeUsePreset'],
      baseline: (config) => config.agent?.claudeUsePreset ?? false,
      label: 'Use Claude Code preset',
      help: (
        <>
          Append the Claude Code preset to the agent&apos;s system prompt. Off by default — the agent receives only the
          project&apos;s prompt.
          <span className="block mt-1" data-testid="claude-preset-regression-note">
            Changed in 0.2.112: the Claude Code preset is now off by default — also in existing projects that never set
            this option, and in conversations already under way, from their next turn. Check this box to restore the
            previous behaviour.
          </span>
        </>
      ),
      effectMessage: EFFECT.perTurn,
    },
    {
      id: 'file-access-enforcement',
      card: 'agent',
      // Same weight as the preset toggle in the spec; declared after it.
      weight: 41,
      kind: 'custom',
      owner: 'agent-chat',
      label: 'File access enforcement',
      component: FileAccessEnforcement,
    },
    {
      id: 'allowed-paths',
      card: 'agent',
      weight: 50,
      kind: 'lines',
      owner: 'agent-chat',
      configKey: ['agent', 'allowedPaths'],
      label: 'Allowed paths',
      placeholder: '/absolute/path/to/extra/dir\n…one per line',
      help: 'Directories the agent may use besides the project directory and the page roots. Absolute paths, one per line.',
      // Resume-locked on the server: a saved change ends resumption of every existing
      // conversation, and the toast has to say so.
      effectMessage: EFFECT.resumeBreak,
      // Hidden while the built-ins are blocked — hidden, not cleared: the values
      // stay in the file and come back when the box is unticked.
      visible: (ctx) => !blockDirectFs(ctx),
    },
    {
      id: 'always-excluded',
      card: 'agent',
      weight: 60,
      kind: 'custom',
      owner: 'agent-chat',
      label: 'Always excluded',
      component: AlwaysExcluded,
    },
    {
      id: 'disallowed-paths',
      card: 'agent',
      weight: 70,
      kind: 'lines',
      owner: 'agent-chat',
      configKey: ['agent', 'disallowedPaths'],
      label: 'Disallowed paths',
      placeholder: '/absolute/path/to/exclude\n…one per line',
      help: 'Excluded from the agent’s file scope; exclusion wins over inclusion. Absolute paths, one per line.',
      // Resume-locked on the server: a saved change ends resumption of every existing
      // conversation, and the toast has to say so.
      effectMessage: EFFECT.resumeBreak,
    },
    {
      id: 'anthropic-api-key',
      card: 'agent',
      weight: 80,
      kind: 'custom',
      owner: 'agent-chat',
      label: 'Anthropic API key',
      component: ApiKeyElement,
    },
  ],
};

/**
 * How much the file-access posture is worth on this host. The badge never claims
 * hardness it does not have, and in every state it names the way around it: a
 * native subagent (Agent / Task) does not inherit these restrictions.
 */
function FileAccessEnforcement(ctx: ElementContext) {
  const { config } = ctx;
  const blocked = blockDirectFs(ctx);
  const gating = config.agent?.toolGating;
  const label = blocked
    ? gating && !gating.enforceable
      ? 'Enforced softly — model hint only'
      : 'Tools removed from the catalog (strength: soft)'
    : config.agent?.pathScopeStrength === 'hard'
      ? 'Enforced by the sandbox'
      : 'Enforced softly (model hint only)';
  const soft = label.startsWith('Enforced softly');
  const color = soft ? '#c99467' : 'var(--c-accent)';
  const escapes = gating?.escapeSurfaces ?? [];
  return (
    <div className="flex flex-col gap-1.5" data-testid="file-access-enforcement">
      <span className="text-[11.5px] font-medium uppercase tracking-wide" style={{ color: 'var(--c-muted)' }}>
        File access enforcement
      </span>
      <span
        className="self-start rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide"
        style={{ background: 'var(--c-panel)', color, border: `1px solid ${color}` }}
      >
        {label}
      </span>
      <span className="text-[11px]" style={{ color: 'var(--c-subtle)' }}>
        One way around it stays open either way: a native subagent (Agent / Task) does not inherit these restrictions
        {escapes.length > 0 ? ` — the runtime also reports: ${escapes.join(', ')}` : ''}.
      </span>
    </div>
  );
}

/**
 * The artifact directories — never reachable through the agent's own file tools,
 * editable only through its MCP tools. Read-only, and not part of
 * `agent.disallowedPaths`: it cannot be switched off.
 */
function AlwaysExcluded({ config }: ElementContext) {
  const dirs = [config.plansDir, config.briefsDir, config.patchesDir, config.entitiesDir, config.releasesDir];
  return (
    <div
      className="flex flex-col gap-1.5 rounded-md px-3 py-2"
      style={{ background: 'var(--c-bg)', border: '1px dashed var(--c-hair)', opacity: 0.85 }}
      data-testid="always-excluded"
    >
      <span className="text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--c-subtle)' }}>
        Always excluded
      </span>
      <ul className="flex flex-col gap-0.5">
        {dirs.map((d, i) => (
          <li key={i} className="text-[12.5px] font-mono" style={{ color: 'var(--c-subtle)' }}>
            {d}
          </li>
        ))}
      </ul>
      <span className="text-[11px]" style={{ color: 'var(--c-subtle)' }}>
        Artifacts are edited only through the agent&apos;s MCP tools. This cannot be disabled.
      </span>
    </div>
  );
}

/**
 * The Anthropic API key — outside `config.json` (`agent_credential`, behind
 * `/api/agent/credentials`), so it saves on its own route, not with the card.
 * Not set: a password field and [Save]. Set: the mask, [Replace] and [Remove].
 */
function ApiKeyElement() {
  const { data: credential } = useAgentCredentials();
  const setKey = useSetAgentCredential();
  const removeKey = useRemoveAgentCredential();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const isSet = credential?.isSet ?? false;
  const busy = setKey.isPending || removeKey.isPending;

  async function handleSave() {
    setError(null);
    try {
      await setKey.mutateAsync(value);
      setValue('');
      setEditing(false);
      toast.success(`Anthropic API key saved. ${EFFECT.perTurnResumed}`);
    } catch (err) {
      // 400 VALIDATION (empty / missing sk-ant- prefix) is shown under the field.
      setError(err instanceof ApiError ? err.message : 'Failed to save the key');
    }
  }

  async function handleRemove() {
    const ok = await confirmDestructive('agent-credential-remove', {
      title: 'Remove Anthropic API key?',
      body: 'The stored key will be deleted and the agent will fall back to your local Claude Code login.',
      confirmLabel: 'Remove',
    });
    if (!ok) return;
    setError(null);
    try {
      await removeKey.mutateAsync();
      setEditing(false);
      setValue('');
      toast.success('Anthropic API key removed — the local login is used again.');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to remove the key');
    }
  }

  const showInput = !isSet || editing;

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11.5px] font-medium uppercase tracking-wide" style={{ color: 'var(--c-muted)' }}>
        Anthropic API key
      </span>

      {isSet && !editing ? (
        <div className="flex items-center gap-2">
          <code className="text-[13px]" style={{ color: 'var(--c-ink)' }}>
            sk-ant-…••••{credential?.last4}
          </code>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setValue('');
              setEditing(true);
            }}
            disabled={busy}
            className="rounded-md px-2.5 py-1 text-[12px] font-medium disabled:opacity-50"
            style={{ border: '1px solid var(--c-hair)', color: 'var(--c-ink)' }}
          >
            Replace
          </button>
          <button
            type="button"
            onClick={() => void handleRemove()}
            disabled={busy}
            className="rounded-md px-2.5 py-1 text-[12px] font-medium disabled:opacity-50"
            style={{ border: '1px solid var(--c-hair)', color: 'var(--c-red, #c45a3b)' }}
          >
            Remove
          </button>
        </div>
      ) : null}

      {showInput ? (
        <div className="flex items-center gap-2">
          <input
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={busy}
            placeholder="sk-ant-..."
            autoComplete="off"
            className="flex-1 rounded-md px-3 py-1.5 text-[13px]"
            style={inputStyle}
          />
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={busy || value.trim() === ''}
            className="rounded-md px-3 py-1.5 text-[12px] font-medium disabled:opacity-50"
            style={{ background: 'var(--c-accent)', color: '#fff' }}
          >
            {setKey.isPending ? 'Saving…' : 'Save'}
          </button>
          {isSet && editing ? (
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setValue('');
                setError(null);
              }}
              disabled={busy}
              className="rounded-md px-2.5 py-1.5 text-[12px] font-medium disabled:opacity-50"
              style={{ border: '1px solid var(--c-hair)', color: 'var(--c-ink)' }}
            >
              Cancel
            </button>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <span className="text-[11.5px]" role="alert" style={{ color: '#a83232' }}>
          {error}
        </span>
      ) : (
        <span className="text-[11px]" style={{ color: 'var(--c-subtle)' }}>
          With a key set, the agent always uses it instead of the local Claude Code login. The key is encrypted and
          stored locally (not in <code>config.json</code>, not in the repo).
        </span>
      )}
    </div>
  );
}
