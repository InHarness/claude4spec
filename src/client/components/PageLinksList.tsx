import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import {
  Check,
  EyeOff,
  FileText,
  Link2,
  Pencil,
  Plus,
  X,
} from 'lucide-react';
import { usePageLinks } from '../hooks/usePageLinks.js';
import { useWritePage } from '../hooks/usePage.js';
import { api } from '../lib/api.js';
import { toast } from '../ui/events.js';
import type { UnresolvedMention } from '../../shared/page-links.js';

type Tab = 'broken' | 'unresolved';

const LITERAL_KEY = 'c4s.links.literal';

function loadLiteralIgnores(): Record<string, string[]> {
  try {
    const raw = window.localStorage.getItem(LITERAL_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function persistLiteralIgnores(map: Record<string, string[]>) {
  try {
    window.localStorage.setItem(LITERAL_KEY, JSON.stringify(map));
  } catch {
    /* localStorage full or unavailable — silent */
  }
}

export function PageLinksList() {
  const { data, isLoading } = usePageLinks();
  const [tab, setTab] = useState<Tab>('broken');
  const [literalIgnores, setLiteralIgnores] =
    useState<Record<string, string[]>>(() => loadLiteralIgnores());

  useEffect(() => {
    persistLiteralIgnores(literalIgnores);
  }, [literalIgnores]);

  const ignoreItem = (sourcePath: string, rawToken: string) => {
    setLiteralIgnores((prev) => {
      const arr = prev[sourcePath] ?? [];
      if (arr.includes(rawToken)) return prev;
      return { ...prev, [sourcePath]: [...arr, rawToken] };
    });
  };

  const grouped = useMemo(() => {
    const all = Object.entries(data?.unresolved ?? {});
    const targetSyntax: UnresolvedMention['syntax'] = tab === 'broken' ? 'link' : 'at';
    const groups: Array<{ sourcePath: string; items: UnresolvedMention[] }> = [];
    for (const [sourcePath, items] of all) {
      const ignored = literalIgnores[sourcePath] ?? [];
      const filtered = items.filter(
        (it) => it.syntax === targetSyntax && !ignored.includes(it.rawToken)
      );
      if (filtered.length > 0) groups.push({ sourcePath, items: filtered });
    }
    return groups.sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));
  }, [data, tab, literalIgnores]);

  const counts = useMemo(() => {
    const all = Object.entries(data?.unresolved ?? {});
    let broken = 0;
    let unresolved = 0;
    for (const [sourcePath, items] of all) {
      const ignored = literalIgnores[sourcePath] ?? [];
      for (const it of items) {
        if (ignored.includes(it.rawToken)) continue;
        if (it.syntax === 'link') broken++;
        else if (it.syntax === 'at') unresolved++;
      }
    }
    return { broken, unresolved };
  }, [data, literalIgnores]);

  if (isLoading && !data) {
    return (
      <div className="flex-1 p-10 text-[13px]" style={{ color: 'var(--c-subtle)' }}>
        Loading links…
      </div>
    );
  }

  const total = counts.broken + counts.unresolved;
  const isEmpty = total === 0;
  const activeCount = tab === 'broken' ? counts.broken : counts.unresolved;

  return (
    <div className="flex-1 overflow-auto nice-scroll">
      <div className="mx-auto" style={{ maxWidth: 820, padding: '40px 48px 120px' }}>
        <div className="flex items-center gap-2 mb-4">
          <Link2 size={18} style={{ color: '#a87033' }} />
          <h1 className="text-[18px] font-semibold" style={{ color: 'var(--c-ink)' }}>
            Links
          </h1>
          <span className="text-[12px] font-mono" style={{ color: 'var(--c-subtle)' }}>
            · {total}
          </span>
        </div>

        <div
          className="flex items-center gap-1 mb-5 p-0.5 rounded-md w-fit"
          style={{ background: 'var(--c-panel)', border: '1px solid var(--c-hair-strong)' }}
        >
          <TabButton
            active={tab === 'broken'}
            onClick={() => setTab('broken')}
            label="Broken links"
            count={counts.broken}
          />
          <TabButton
            active={tab === 'unresolved'}
            onClick={() => setTab('unresolved')}
            label="Unresolved mentions"
            count={counts.unresolved}
          />
        </div>

        {isEmpty ? (
          <div
            className="rounded-md p-8 text-center text-[13px]"
            style={{
              background: 'var(--c-panel)',
              color: 'var(--c-subtle)',
              border: '1px dashed var(--c-hair-strong)',
            }}
          >
            No broken links or unresolved mentions. All page references resolve.
          </div>
        ) : activeCount === 0 ? (
          <div
            className="rounded-md p-5 text-center text-[13px]"
            style={{
              background: 'var(--c-panel)',
              color: 'var(--c-subtle)',
              border: '1px dashed var(--c-hair-strong)',
            }}
          >
            No {tab === 'broken' ? 'broken links' : 'unresolved mentions'}.
          </div>
        ) : (
          grouped.map((g) => (
            <SourceGroup
              key={g.sourcePath}
              sourcePath={g.sourcePath}
              items={g.items}
              onIgnore={(rawToken) => ignoreItem(g.sourcePath, rawToken)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function TabButton({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="px-3 py-1 rounded text-[12.5px] font-medium transition flex items-center gap-2"
      style={{
        background: active ? 'var(--c-bg)' : 'transparent',
        color: active ? 'var(--c-ink)' : 'var(--c-muted)',
        border: `1px solid ${active ? 'var(--c-hair-strong)' : 'transparent'}`,
      }}
    >
      <span>{label}</span>
      <span
        className="font-mono"
        style={{
          fontSize: 10.5,
          color: count > 0 ? '#a87033' : 'var(--c-subtle)',
        }}
      >
        {count}
      </span>
    </button>
  );
}

function SourceGroup({
  sourcePath,
  items,
  onIgnore,
}: {
  sourcePath: string;
  items: UnresolvedMention[];
  onIgnore: (rawToken: string) => void;
}) {
  const navigate = useNavigate();
  return (
    <section className="mb-6">
      <button
        onClick={() => navigate({ to: '/pages/$', params: { _splat: sourcePath } })}
        className="flex items-center gap-2 mb-2 hover:underline"
      >
        <FileText size={12} style={{ color: 'var(--c-muted)' }} />
        <h2 className="text-[12px] font-mono" style={{ color: 'var(--c-muted)' }}>
          {sourcePath}
        </h2>
        <span className="text-[11px]" style={{ color: 'var(--c-subtle)' }}>
          {items.length}
        </span>
      </button>
      <div className="space-y-1.5">
        {items.map((it) => (
          <UnresolvedRow
            key={`${it.line}:${it.col}:${it.rawToken}`}
            sourcePath={sourcePath}
            item={it}
            onIgnore={() => onIgnore(it.rawToken)}
          />
        ))}
      </div>
    </section>
  );
}

function UnresolvedRow({
  sourcePath,
  item,
  onIgnore,
}: {
  sourcePath: string;
  item: UnresolvedMention;
  onIgnore: () => void;
}) {
  const navigate = useNavigate();
  const writePage = useWritePage();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.candidatePath);
  const [busy, setBusy] = useState(false);

  const canCreate = item.candidatePath.toLowerCase().endsWith('.md');
  const labelKind = item.syntax === 'link' ? 'broken link' : 'unresolved';

  const goToSource = () => {
    void navigate({ to: '/pages/$', params: { _splat: sourcePath } });
  };

  async function handleCreate() {
    if (!canCreate || busy) return;
    setBusy(true);
    try {
      const title = deriveTitle(item.candidatePath);
      await writePage.mutateAsync({
        path: item.candidatePath,
        body: `# ${title}\n\n`,
      });
      toast.success(`Created ${item.candidatePath}`);
      void navigate({ to: '/pages/$', params: { _splat: item.candidatePath } });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveFix() {
    const newPath = draft.trim();
    if (!newPath || newPath === item.candidatePath || busy) {
      setEditing(false);
      return;
    }
    setBusy(true);
    try {
      const page = await api.read(sourcePath);
      const newToken = item.rawToken.replace(item.candidatePath, newPath);
      if (!page.body.includes(item.rawToken)) {
        toast.error(`Token "${item.rawToken}" not found in ${sourcePath}`);
        return;
      }
      const nextBody = page.body.replace(item.rawToken, newToken);
      await writePage.mutateAsync({
        path: sourcePath,
        body: nextBody,
        frontmatter: page.frontmatter,
      });
      toast.success(`Fixed ${item.rawToken} → ${newToken}`);
      setEditing(false);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="rounded-md px-3 py-2"
      style={{
        background: 'var(--c-panel)',
        border: '1px solid var(--c-hair-strong)',
      }}
    >
      <div className="flex items-start gap-3">
        <span
          className="inline-flex items-center justify-center rounded mt-0.5 shrink-0"
          style={{
            width: 18,
            height: 18,
            background: 'rgba(196, 90, 59, 0.14)',
            color: '#c45a3b',
          }}
          title={labelKind}
        >
          <Link2 size={11} />
        </span>
        <div className="flex-1 min-w-0">
          <div
            className="text-[13px] font-mono truncate"
            style={{ color: 'var(--c-ink)' }}
            title={item.rawToken}
          >
            {item.rawToken}
          </div>
          <div
            className="text-[11px] font-mono mt-0.5"
            style={{ color: 'var(--c-subtle)' }}
          >
            line {item.line}
            {item.col > 0 ? `, col ${item.col}` : ''} · candidate{' '}
            <span style={{ color: 'var(--c-muted)' }}>{item.candidatePath}</span>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={goToSource}
            className="px-2 py-1 rounded text-[11.5px]"
            style={{
              color: 'var(--c-muted)',
              border: '1px solid var(--c-hair-strong)',
            }}
            title="Open source page"
          >
            Open
          </button>
          {canCreate && (
            <button
              onClick={handleCreate}
              disabled={busy}
              className="px-2 py-1 rounded text-[11.5px] flex items-center gap-1"
              style={{
                color: '#a87033',
                border: '1px solid rgba(168, 112, 51, 0.4)',
                opacity: busy ? 0.5 : 1,
              }}
              title={`Create ${item.candidatePath}`}
            >
              <Plus size={10} />
              {item.syntax === 'link' ? 'Create page' : 'Create file'}
            </button>
          )}
          <button
            onClick={() => {
              setDraft(item.candidatePath);
              setEditing((v) => !v);
            }}
            className="px-2 py-1 rounded text-[11.5px] flex items-center gap-1"
            style={{
              color: 'var(--c-muted)',
              border: '1px solid var(--c-hair-strong)',
            }}
            title="Fix typo (inline edit)"
          >
            <Pencil size={10} />
            Fix typo
          </button>
          <button
            onClick={onIgnore}
            className="px-2 py-1 rounded text-[11.5px] flex items-center gap-1"
            style={{
              color: 'var(--c-subtle)',
              border: '1px solid var(--c-hair-strong)',
            }}
            title="Ignore in this source (saved locally)"
          >
            <EyeOff size={10} />
            Mark literal
          </button>
        </div>
      </div>
      {editing && (
        <div className="mt-2 pl-[30px] flex items-center gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleSaveFix();
              else if (e.key === 'Escape') setEditing(false);
            }}
            autoFocus
            spellCheck={false}
            className="flex-1 rounded px-2 py-1 text-[12.5px] font-mono outline-none"
            style={{
              background: 'var(--c-bg)',
              border: '1px solid var(--c-accent)',
              color: 'var(--c-ink)',
            }}
          />
          <button
            onClick={() => void handleSaveFix()}
            disabled={busy}
            className="px-2 py-1 rounded text-[11.5px] flex items-center gap-1"
            style={{
              background: 'var(--c-accent)',
              color: '#fff',
              opacity: busy ? 0.5 : 1,
            }}
          >
            <Check size={10} />
            Save
          </button>
          <button
            onClick={() => setEditing(false)}
            className="px-2 py-1 rounded text-[11.5px] flex items-center gap-1"
            style={{
              color: 'var(--c-muted)',
              border: '1px solid var(--c-hair-strong)',
            }}
          >
            <X size={10} />
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

function deriveTitle(filePath: string): string {
  const base = filePath.split('/').pop() ?? 'untitled';
  return base.replace(/\.md$/, '').replaceAll('-', ' ');
}
