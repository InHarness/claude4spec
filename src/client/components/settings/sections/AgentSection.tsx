import { useState } from 'react';
import { useConfig, usePatchConfig } from '../../../hooks/useConfig.js';
import {
  useAgentCredentials,
  useSetAgentCredential,
  useRemoveAgentCredential,
} from '../../../hooks/useAgentCredentials.js';
import { ApiError } from '../../../lib/api.js';
import { confirmDestructive, toast } from '../../../ui/events.js';
import { SettingsCard } from '../SettingsCard.js';
import { SUPPORTED_LANGUAGES } from '../../../../shared/languages.js';

const inputStyle: React.CSSProperties = {
  background: 'var(--c-bg)',
  border: '1px solid var(--c-hair)',
  color: 'var(--c-ink)',
};

const STRENGTH_META: Record<'hard' | 'soft' | 'none', { label: string; color: string; detail: string }> = {
  hard: {
    label: 'Hard (OS-enforced)',
    color: 'var(--c-accent)',
    detail:
      'Backed by the OS sandbox (seatbelt on macOS, bubblewrap on Linux) — out-of-scope paths are blocked at the syscall level.',
  },
  soft: {
    label: 'Soft (model-visible only)',
    color: '#c99467',
    detail:
      'This host has no OS sandbox available — the scope is only a prompt hint and SDK permission rule, not enforced at the OS level.',
  },
  none: {
    label: 'Not configured',
    color: 'var(--c-subtle)',
    detail: 'No allowed/disallowed paths are set — the agent is unscoped beyond the project directory and configured roots.',
  },
};

/** 0.1.103: live badge for the real, probed path-scope enforcement strength (`GET /api/config`'s `agent.pathScopeStrength`). */
function PathScopeStrengthBadge({ strength }: { strength: 'hard' | 'soft' | 'none' }) {
  const [show, setShow] = useState(false);
  const meta = STRENGTH_META[strength];
  return (
    <span style={{ position: 'relative' }} onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      <span
        className="rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide"
        style={{ background: 'var(--c-panel)', color: meta.color, border: `1px solid ${meta.color}` }}
      >
        {meta.label}
      </span>
      {show && (
        <div
          className="text-[11px]"
          style={{
            position: 'absolute',
            top: 20,
            left: 0,
            zIndex: 1050,
            minWidth: 220,
            padding: 10,
            background: 'var(--c-card)',
            border: '1px solid var(--c-hair-strong)',
            borderRadius: 6,
            boxShadow: '0 8px 20px rgba(0,0,0,0.10)',
            color: 'var(--c-ink)',
            whiteSpace: 'normal',
          }}
        >
          {meta.detail}
        </div>
      )}
    </span>
  );
}

/**
 * M26 §1, §2 — Agent section. `claudeUsePreset` is per-query hot-reload (the next
 * chat turn picks it up). `conversationalLanguage` (0.1.51) takes effect only from
 * the first turn of the next new thread (prompt persisted per-thread).
 */
export function AgentSection() {
  const { data: config } = useConfig();
  const patch = usePatchConfig();
  const usePreset = config?.agent?.claudeUsePreset ?? true;
  const [languageError, setLanguageError] = useState<string | null>(null);

  async function handleToggle(next: boolean) {
    try {
      await patch.mutateAsync({ agent: { claudeUsePreset: next } });
      toast.success('Agent settings updated');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Update failed');
    }
  }

  async function handleChangeConversationalLanguage(value: string) {
    setLanguageError(null);
    try {
      // Deep-merged server-side — sending conversationalLanguage alone preserves claudeUsePreset.
      await patch.mutateAsync({ agent: { conversationalLanguage: value === '' ? null : value } });
      toast.success('Conversation language updated');
    } catch (err) {
      if (err instanceof ApiError) {
        setLanguageError(err.message);
      } else {
        toast.error('Failed to update conversation language');
      }
    }
  }

  return (
    <SettingsCard
      id="agent"
      title="Agent"
      description="Tweaks applied to chat turns powered by Claude Code."
      badge="hot-reload"
    >
      <div className="flex flex-col gap-4">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={usePreset}
            onChange={(e) => void handleToggle(e.target.checked)}
            disabled={patch.isPending}
            className="mt-0.5 h-4 w-4"
          />
          <span className="flex-1">
            <span className="block text-[13px] font-medium" style={{ color: 'var(--c-ink)' }}>
              Append the Claude Code preset to the system prompt
            </span>
            <span className="block text-[11.5px] mt-0.5" style={{ color: 'var(--c-subtle)' }}>
              Default. Turn off only when the writing-style skill provides its own complete preset.
            </span>
          </span>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[11.5px] font-medium uppercase tracking-wide" style={{ color: 'var(--c-muted)' }}>
            Conversation language
          </span>
          <select
            value={config?.agent?.conversationalLanguage ?? ''}
            onChange={(e) => void handleChangeConversationalLanguage(e.target.value)}
            disabled={patch.isPending}
            className="w-full rounded-md px-3 py-1.5 text-[13px]"
            style={{ background: 'var(--c-bg)', border: '1px solid var(--c-hair)', color: 'var(--c-ink)' }}
            title="The language the agent always replies to you in, regardless of the question's language. Not the spec content language — set that in the Project section."
          >
            <option value="">(none)</option>
            {SUPPORTED_LANGUAGES.map((lang) => (
              <option key={lang} value={lang}>
                {lang}
              </option>
            ))}
          </select>
          {languageError ? (
            <span className="text-[11.5px]" style={{ color: '#a83232' }}>
              {languageError}
            </span>
          ) : (
            <span className="text-[11px]" style={{ color: 'var(--c-subtle)' }}>
              The agent replies in this language regardless of your input. Applied from your next new thread.
            </span>
          )}
        </label>

        <PathScopeFields />

        <ApiKeyField />
      </div>
    </SettingsCard>
  );
}

/**
 * 0.1.90 (M26) — "Agent file scope". Two textareas (one path per line) that map to
 * `agent.allowedPaths` / `agent.disallowedPaths`. By default the agent sees only the
 * project dir (`cwd`) and the pages dir; ALLOWED widens, DISALLOWED carves out
 * (exclusion wins). Saved via PATCH /api/config — deep-merged server-side, so each
 * field is sent alone and the other agent flags are preserved. Hot-reload per turn.
 */
function PathScopeFields() {
  const { data: config } = useConfig();
  const patch = usePatchConfig();
  const strength = config?.agent?.pathScopeStrength ?? 'none';

  // Nullable-draft pattern (mirror ProjectSection): null = unedited (mirror config).
  const [allowedDraft, setAllowedDraft] = useState<string | null>(null);
  const [disallowedDraft, setDisallowedDraft] = useState<string | null>(null);

  const baselineAllowed = (config?.agent?.allowedPaths ?? []).join('\n');
  const baselineDisallowed = (config?.agent?.disallowedPaths ?? []).join('\n');
  const allowedValue = allowedDraft ?? baselineAllowed;
  const disallowedValue = disallowedDraft ?? baselineDisallowed;
  const allowedDirty = allowedDraft !== null && allowedDraft !== baselineAllowed;
  const disallowedDirty = disallowedDraft !== null && disallowedDraft !== baselineDisallowed;

  const parse = (text: string): string[] => text.split('\n').map((l) => l.trim()).filter(Boolean);

  async function save(
    field: 'allowedPaths' | 'disallowedPaths',
    value: string,
    reset: (v: string | null) => void,
    label: string,
  ) {
    try {
      await patch.mutateAsync({ agent: { [field]: parse(value) } });
      reset(null);
      toast.success(`${label} updated`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : `Failed to update ${label}`);
    }
  }

  const tooltip =
    'By default the agent sees only the project directory (cwd) and the pages directory. ' +
    'ALLOWED PATHS adds directories, DISALLOWED PATHS excludes them (exclusion takes precedence). ' +
    'Use absolute paths, one per line.';

  return (
    <div className="flex flex-col gap-3" title={tooltip}>
      <div className="flex items-center gap-2">
        <span className="text-[11.5px] font-medium uppercase tracking-wide" style={{ color: 'var(--c-muted)' }}>
          Agent file scope
        </span>
        <PathScopeStrengthBadge strength={strength} />
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--c-subtle)' }}>
          Allowed paths
        </span>
        <textarea
          value={allowedValue}
          onChange={(e) => setAllowedDraft(e.target.value)}
          disabled={patch.isPending}
          rows={3}
          spellCheck={false}
          placeholder={'/absolute/path/to/extra/dir\n…one per line'}
          className="w-full rounded-md px-3 py-1.5 text-[12.5px] font-mono resize-y"
          style={inputStyle}
        />
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => void save('allowedPaths', allowedValue, setAllowedDraft, 'Allowed paths')}
            disabled={patch.isPending || !allowedDirty}
            className="rounded-md px-3 py-1 text-[12px] font-medium disabled:opacity-50"
            style={{ background: 'var(--c-accent)', color: '#fff' }}
          >
            Save
          </button>
        </div>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--c-subtle)' }}>
          Disallowed paths
        </span>
        <textarea
          value={disallowedValue}
          onChange={(e) => setDisallowedDraft(e.target.value)}
          disabled={patch.isPending}
          rows={3}
          spellCheck={false}
          placeholder={'/absolute/path/to/exclude\n…one per line'}
          className="w-full rounded-md px-3 py-1.5 text-[12.5px] font-mono resize-y"
          style={inputStyle}
        />
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => void save('disallowedPaths', disallowedValue, setDisallowedDraft, 'Disallowed paths')}
            disabled={patch.isPending || !disallowedDirty}
            className="rounded-md px-3 py-1 text-[12px] font-medium disabled:opacity-50"
            style={{ background: 'var(--c-accent)', color: '#fff' }}
          >
            Save
          </button>
        </div>
      </label>

      <span className="text-[11px]" style={{ color: 'var(--c-subtle)' }}>
        Exclusion takes precedence over inclusion. Applied from your next chat turn. See the badge above for
        whether this host actually enforces the scope at the OS level or only as a model-visible hint.
      </span>
    </div>
  );
}

/**
 * M05 0.1.62 — "Anthropic API key" group. No toggle: a stored key always wins over
 * the local Claude Code login; removing it restores the local login. The key is
 * write-only server-side — we only ever see `{ isSet, last4 }`.
 */
function ApiKeyField() {
  const { data: credential } = useAgentCredentials();
  const setKey = useSetAgentCredential();
  const removeKey = useRemoveAgentCredential();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const isSet = credential?.isSet ?? false;
  const busy = setKey.isPending || removeKey.isPending;

  async function handleSave() {
    setError(null);
    try {
      await setKey.mutateAsync(draft);
      setDraft('');
      setEditing(false);
      toast.success('Anthropic API key saved');
    } catch (err) {
      // 400 VALIDATION (empty / missing sk-ant- prefix) surfaces inline under the field.
      setError(err instanceof ApiError ? err.message : 'Failed to save the key');
    }
  }

  async function handleRemove() {
    const ok = await confirmDestructive({
      title: 'Remove Anthropic API key?',
      body: 'The stored key will be deleted and the agent will fall back to your local Claude Code login.',
      confirmLabel: 'Remove',
    });
    if (!ok) return;
    setError(null);
    try {
      await removeKey.mutateAsync();
      setEditing(false);
      setDraft('');
      toast.success('Anthropic API key removed');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to remove the key');
    }
  }

  const showInput = !isSet || editing;

  return (
    <label className="flex flex-col gap-1.5">
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
              setDraft('');
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
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={busy}
            placeholder="sk-ant-..."
            autoComplete="off"
            className="flex-1 rounded-md px-3 py-1.5 text-[13px]"
            style={inputStyle}
          />
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={busy || draft.trim() === ''}
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
                setDraft('');
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
        <span className="text-[11.5px]" style={{ color: '#a83232' }}>
          {error}
        </span>
      ) : (
        <span className="text-[11px]" style={{ color: 'var(--c-subtle)' }}>
          If you set a key, the agent always uses it instead of the local Claude Code login. The key is
          encrypted and stored locally (not in <code>config.json</code>, not in the repo).
        </span>
      )}
    </label>
  );
}
