import { useState } from 'react';
import type { UsageStats } from '@inharness-ai/agent-chat';
import type { ChatModel } from '../state/chat.js';

// Lokalne defaulty — NIE inline z @inharness-ai/agent-adapters.
// Biblioteka ma 200_000 dla wszystkich claude-code modeli (zgodnie z publicznym SDK),
// ale ta aplikacja odpala Opus 4.7 z betą `context-1m-2025-08-07` → 1M okno.
// Override per-thread przez `architectureConfig.context_window_override` (konwencja
// z agent-adapters/src/options.ts — UI-only, adaptery ignorują).
const CLAUDE_CODE_CONTEXT_WINDOWS: Record<ChatModel, number> = {
  'sonnet-4.6': 200_000,
  'opus-4.7': 1_000_000,
  'haiku-4.5': 200_000,
};

interface Props {
  usage: UsageStats | null;
  contextSize: number | null;
  model: ChatModel;
  architectureConfig?: Record<string, unknown>;
}

export function UsageBadge({ usage, contextSize, model, architectureConfig }: Props) {
  const [showTooltip, setShowTooltip] = useState(false);
  const overrideRaw = architectureConfig?.context_window_override;
  const override = typeof overrideRaw === 'number' && overrideRaw > 0 ? overrideRaw : undefined;
  const contextWindow = override ?? CLAUDE_CODE_CONTEXT_WINDOWS[model] ?? 200_000;

  // agent-chat 0.1.1: contextSize jest last-turn utilization (NIE cumulative).
  // Sumowanie inputTokens+outputTokens+cache w starym kodzie dawalo >100% po
  // kilku turach — biblioteka teraz wystawia poprawną wartość bezpośrednio.
  const percent =
    contextSize != null && contextWindow > 0
      ? Math.min(100, (contextSize / contextWindow) * 100)
      : null;

  const color =
    percent == null
      ? 'var(--c-subtle)'
      : percent >= 80
        ? 'var(--c-red, #c45a3b)'
        : percent >= 60
          ? '#c99467'
          : 'var(--c-muted)';

  const label = percent == null ? '—' : `${percent < 1 ? percent.toFixed(1) : Math.round(percent)}%`;

  return (
    <div
      style={{ position: 'relative' }}
      onMouseEnter={() => setShowTooltip(Boolean(usage))}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <span
        className="font-mono text-[10.5px] px-1.5 py-0.5 rounded"
        style={{
          background: 'var(--c-panel)',
          color,
          border: `1px solid ${color}`,
          lineHeight: 1.2,
        }}
        title={usage ? undefined : 'No usage yet for this thread'}
      >
        context {label}
      </span>
      {showTooltip && usage && (
        <div
          style={{
            position: 'absolute',
            top: 24,
            right: 0,
            zIndex: 1050,
            minWidth: 220,
            padding: 10,
            background: 'var(--c-card)',
            border: '1px solid var(--c-hair-strong)',
            borderRadius: 6,
            boxShadow: '0 8px 20px rgba(0,0,0,0.10)',
            fontSize: 11,
            color: 'var(--c-ink)',
            whiteSpace: 'nowrap',
          }}
        >
          <div
            className="text-[10.5px] uppercase tracking-wider font-mono mb-1.5"
            style={{ color: 'var(--c-subtle)' }}
          >
            Token usage
          </div>
          <Row label="Input" value={usage.inputTokens} total={contextWindow} />
          <Row label="Output" value={usage.outputTokens} total={contextWindow} />
          {usage.cacheReadInputTokens != null && usage.cacheReadInputTokens > 0 && (
            <Row label="Cache read" value={usage.cacheReadInputTokens} total={contextWindow} />
          )}
          {usage.cacheCreationInputTokens != null && usage.cacheCreationInputTokens > 0 && (
            <Row
              label="Cache write"
              value={usage.cacheCreationInputTokens}
              total={contextWindow}
            />
          )}
          <div
            style={{
              borderTop: '1px solid var(--c-hair)',
              marginTop: 6,
              paddingTop: 6,
              display: 'flex',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <span style={{ color: 'var(--c-muted)' }}>Context window</span>
            <span className="font-mono">{formatNumber(contextWindow)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, total }: { label: string; value: number; total: number }) {
  const pct = (value / total) * 100;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, lineHeight: 1.5 }}>
      <span style={{ color: 'var(--c-muted)' }}>{label}</span>
      <span className="font-mono">
        {formatNumber(value)} <span style={{ color: 'var(--c-subtle)' }}>({pct.toFixed(1)}%)</span>
      </span>
    </div>
  );
}

function formatNumber(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}
