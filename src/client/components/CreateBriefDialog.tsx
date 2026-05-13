import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { FileText, X } from 'lucide-react';
import { useCreateBrief } from '../hooks/useBriefs.js';
import { useReleases } from '../hooks/useReleases.js';
import { useChatStore } from '../state/chat.js';
import { encodeBriefPath } from '../lib/briefs-api.js';
import { requestChatPrefill } from '../chat/chatPrefill.js';

const ADDITIONAL_PROMPT_LS_KEY = 'c4s.briefs.lastAdditionalPrompt';

/**
 * Sentinel value w `<select>` reprezentujacy "initial brief" (from_release = null).
 * HTML option value to string, wiec uzywamy markera; przy submit mapujemy na null.
 */
const INITIAL_FROM_VALUE = '__INITIAL__';

interface Props {
  /** Pre-populated `to_release` (the release the user opened). User picks the from. */
  toReleaseName: string;
  onClose: () => void;
}

/**
 * M21 modal "Generate brief from this release". Z `to_release` prepopulated
 * (release ktory user wlasnie ogląda), dropdown wybiera `from_release`
 * (chronologicznie wczesniejszy, ale nie wymuszone — frontend dopuszcza
 * dowolny wybor, backend waliduje from !== to). Po success: redirect do
 * `/briefs/<path>` + auto-prefill chatu pierwszym promptem inicjacyjnym.
 */
export function CreateBriefDialog({ toReleaseName, onClose }: Props) {
  const { data: allReleases = [] } = useReleases();
  const create = useCreateBrief();
  const navigate = useNavigate();
  const setChatThreadId = useChatStore((s) => s.setChatThreadId);
  const setChatOpen = useChatStore((s) => s.setChatOpen);

  // Pusty string = nic nie wybrane; INITIAL_FROM_VALUE = initial brief; inny string = nazwa release.
  const [fromReleaseName, setFromReleaseName] = useState('');
  const [additionalPrompt, setAdditionalPrompt] = useState(
    () => localStorage.getItem(ADDITIONAL_PROMPT_LS_KEY) ?? '',
  );
  const [suffix, setSuffix] = useState('');
  const [error, setError] = useState<string | null>(null);

  const candidates = allReleases.filter((r) => r.name !== toReleaseName);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fromReleaseName) {
      setError('Pick a "from" release (or "initial state" for the very first brief).');
      return;
    }
    setError(null);
    const ap = additionalPrompt.trim();
    // Persist preset niezależnie od sukcesu POST — user wpisał wytyczne, chce
    // żeby były pamiętane przy następnym otwarciu modala.
    if (ap) {
      localStorage.setItem(ADDITIONAL_PROMPT_LS_KEY, ap);
    } else {
      localStorage.removeItem(ADDITIONAL_PROMPT_LS_KEY);
    }
    const isInitial = fromReleaseName === INITIAL_FROM_VALUE;
    const apiFromName = isInitial ? null : fromReleaseName;
    try {
      const result = await create.mutateAsync({
        fromReleaseName: apiFromName,
        toReleaseName,
        additionalPrompt: ap || undefined,
        suffix: suffix.trim() || undefined,
      });
      onClose();
      navigate({
        to: '/briefs/$path',
        params: { path: encodeBriefPath(result.briefPath) },
      });
      setChatThreadId(result.initialThreadId);
      setChatOpen(true);
      // Skleć boilerplate z additionalPrompt jako dodatkową sekcją (patrz brief
      // v0.1.9 → v0.1.10 punkt „For implementers" #7). autoSend=true: ChatOverlay
      // wyśle wiadomość do agenta od razu, bez czekania na manualny send.
      const baseLine = isInitial
        ? `Wygeneruj initial brief opisujacy stan ${toReleaseName} (pierwszy release projektu — bez poprzednika do porownania).`
        : `Wygeneruj brief dla zmian ${fromReleaseName} → ${toReleaseName}.`;
      const prompt = ap ? `${baseLine}\n\n## Dodatkowe wytyczne\n${ap}` : baseLine;
      requestChatPrefill({ prompt, autoSend: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="rounded-lg w-[480px] p-5"
        style={{
          background: 'var(--c-bg)',
          border: '1px solid var(--c-hair-strong)',
          boxShadow: '0 12px 40px rgba(0,0,0,0.18)',
        }}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <FileText size={16} style={{ color: 'var(--c-accent)' }} />
            <h3 className="text-[14px] font-semibold" style={{ color: 'var(--c-ink)' }}>
              Generate brief from {toReleaseName}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 btn-ghost"
            style={{ color: 'var(--c-muted)' }}
          >
            <X size={14} />
          </button>
        </div>

        <div className="space-y-3 text-[12.5px]">
          <label className="block">
            <span style={{ color: 'var(--c-muted)' }}>From release</span>
            <select
              value={fromReleaseName}
              onChange={(e) => setFromReleaseName(e.target.value)}
              className="mt-1 w-full rounded-md px-2 py-1.5 font-mono text-[12.5px]"
              style={{
                background: 'var(--c-card)',
                border: '1px solid var(--c-hair)',
                color: 'var(--c-ink)',
              }}
              required
            >
              <option value="">— pick a release —</option>
              <option value={INITIAL_FROM_VALUE}>— initial state (no previous release) —</option>
              {candidates.map((r) => (
                <option key={r.id} value={r.name}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span style={{ color: 'var(--c-muted)' }}>To release (current)</span>
            <input
              type="text"
              value={toReleaseName}
              disabled
              className="mt-1 w-full rounded-md px-2 py-1.5 font-mono text-[12.5px]"
              style={{
                background: 'var(--c-panel)',
                border: '1px solid var(--c-hair)',
                color: 'var(--c-muted)',
              }}
            />
          </label>

          <label className="block">
            <span style={{ color: 'var(--c-muted)' }}>Dodatkowy prompt (opcjonalne)</span>
            <textarea
              value={additionalPrompt}
              onChange={(e) => setAdditionalPrompt(e.target.value)}
              placeholder="po polsku, dla juniora, ton formalny"
              rows={3}
              className="mt-1 w-full rounded-md px-2 py-1.5 text-[12.5px]"
              style={{
                background: 'var(--c-card)',
                border: '1px solid var(--c-hair)',
                color: 'var(--c-ink)',
                resize: 'vertical',
                fontFamily: 'inherit',
              }}
            />
            <span className="mt-1 block text-[11px]" style={{ color: 'var(--c-subtle)' }}>
              język, audytorium, ton, ad-hoc wytyczne — doklejony do pierwszej wiadomości do agenta. Nie zapisywany w briefie.
            </span>
          </label>

          <label className="block">
            <span style={{ color: 'var(--c-muted)' }}>Filename suffix (optional)</span>
            <input
              type="text"
              value={suffix}
              onChange={(e) => setSuffix(e.target.value)}
              placeholder="e.g. juniors"
              className="mt-1 w-full rounded-md px-2 py-1.5 text-[12.5px] font-mono"
              style={{
                background: 'var(--c-card)',
                border: '1px solid var(--c-hair)',
                color: 'var(--c-ink)',
              }}
            />
          </label>

          {error && (
            <div className="text-[12px] px-2 py-1.5 rounded" style={{ background: 'rgba(179, 58, 58, 0.08)', color: '#b33a3a' }}>
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 mt-5">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded text-[12.5px] btn-ghost"
            style={{ color: 'var(--c-muted)' }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={create.isPending}
            className="px-3 py-1.5 rounded text-[12.5px]"
            style={{ background: 'var(--c-accent)', color: '#fff', opacity: create.isPending ? 0.6 : 1 }}
          >
            {create.isPending ? 'Generating…' : 'Generate brief'}
          </button>
        </div>
      </form>
    </div>
  );
}
