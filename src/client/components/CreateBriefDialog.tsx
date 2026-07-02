import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { FileText, X } from 'lucide-react';
import { useCreateBrief } from '../hooks/useBriefs.js';
import { useReleases } from '../hooks/useReleases.js';
import { useRoots } from '../hooks/useConfig.js';
import { useChatStore } from '../state/chat.js';
import { encodeBriefPath } from '../lib/briefs-api.js';
import { BriefScopeFields, type BriefScope } from './briefs/BriefScopeModal.js';

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
  const roots = useRoots();
  const create = useCreateBrief();
  const navigate = useNavigate();
  const setChatThreadId = useChatStore((s) => s.setChatThreadId);
  const setChatOpen = useChatStore((s) => s.setChatOpen);
  const setSeedPrompt = useChatStore((s) => s.setSeedPrompt);

  // Pusty string = nic nie wybrane; INITIAL_FROM_VALUE = initial brief; inny string = nazwa release.
  const [fromReleaseName, setFromReleaseName] = useState('');
  const [suffix, setSuffix] = useState('');
  // M21/L13 brief scope — whole-release (default) vs a selected briefTarget-root subset.
  const [scope, setScope] = useState<BriefScope>({ kind: 'whole-release' });
  const [error, setError] = useState<string | null>(null);

  const candidates = allReleases.filter((r) => r.name !== toReleaseName);
  // `from` for the per-root changed-page count probe: null for the initial brief.
  const probeFrom =
    fromReleaseName === INITIAL_FROM_VALUE ? null : fromReleaseName || null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fromReleaseName) {
      setError('Pick a "from" release (or "initial state" for the very first brief).');
      return;
    }
    if (scope.kind === 'roots' && scope.roots.length === 0) {
      setError('Select at least one root, or choose "Whole release".');
      return;
    }
    setError(null);
    const isInitial = fromReleaseName === INITIAL_FROM_VALUE;
    const apiFromName = isInitial ? null : fromReleaseName;
    try {
      const result = await create.mutateAsync({
        fromReleaseName: apiFromName,
        toReleaseName,
        suffix: suffix.trim() || undefined,
        // Omit `roots` for whole-release (backward-compat: no frontmatter / slug segment).
        roots: scope.kind === 'roots' ? scope.roots : undefined,
      });
      onClose();
      // Wypełniamy prompt w czacie bez wysyłki: setSeedPrompt ma priorytet w
      // restore-draft effekcie ChatOverlay (czytany przy zmianie chatThreadId),
      // więc nie ma race'a z handle.clear() jak przy requestChatPrefill. User
      // wybiera model w ModelSettingsPopover (mutowalny, bo wątek bez sesji),
      // ewentualnie dopisuje wytyczne, i sam wysyła pierwszą wiadomość.
      const prompt = isInitial
        ? `Generate an initial brief describing the state of ${toReleaseName} (first release of the project — no predecessor to compare against).`
        : `Generate a brief for the changes ${fromReleaseName} → ${toReleaseName}.`;
      setSeedPrompt(prompt);
      navigate({
        to: '/briefs/$path',
        params: { path: encodeBriefPath(result.briefPath) },
      });
      setChatThreadId(result.initialThreadId);
      setChatOpen(true);
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

          <div>
            <span style={{ color: 'var(--c-muted)' }}>Scope</span>
            <div className="mt-1">
              <BriefScopeFields
                fromReleaseName={probeFrom}
                toReleaseName={toReleaseName}
                roots={roots}
                onChange={setScope}
              />
            </div>
          </div>

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
            {create.isPending ? 'Preparing…' : 'Prepare brief'}
          </button>
        </div>
      </form>
    </div>
  );
}
