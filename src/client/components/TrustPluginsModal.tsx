import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { clientPluginHost } from '../core/plugin-host/host.js';
import { ApiError, metaApi } from '../lib/api.js';
import { toast } from '../ui/events.js';

/**
 * M33 phase 2 — blocking trust prompt for project-committed plugins.
 *
 * When a project ships `<cwd>/.claude4spec/plugins/` and the machine has not yet
 * decided `trustProjectPlugins` (per workspace × project, stored in
 * `~/.claude4spec/`), this modal blocks the shell on first open. Because a
 * `git clone` carries that code, the user explicitly authorizes (or refuses) its
 * execution before the overlay is built. After a decision the server rebuilds the
 * `ProjectContext` (no process restart); we refetch the activation partition so
 * newly-trusted overlay types wake without a full reload.
 */
export function TrustPluginsModal() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['plugins-meta'], queryFn: () => metaApi.plugins() });
  const [busy, setBusy] = useState(false);

  // Only block when local plugins exist AND no decision has been recorded yet.
  if (!data || !data.localPluginsPresent || data.trust !== undefined) return null;

  const overlayPackages = data.packages.filter((p) => p.layer === 'overlay');

  async function decide(trust: boolean) {
    setBusy(true);
    try {
      await metaApi.setTrustPlugins(trust);
      // Context rebuilt server-side on the next request — re-seed activation so
      // trusted overlay types flip to active, then refresh dependent queries.
      try {
        const activation = await metaApi.entities();
        clientPluginHost.applyActivation(activation);
      } catch {
        /* non-fatal — host keeps its current activation */
      }
      await qc.invalidateQueries();
      toast.success(trust ? 'Project plugins trusted' : 'Project plugins refused');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to save trust decision');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Trust project plugins"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.35)',
        zIndex: 1300,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          width: 460,
          maxWidth: 'calc(100vw - 32px)',
          background: 'var(--c-card)',
          border: '1px solid var(--c-hair-strong)',
          borderRadius: 8,
          padding: 20,
          boxShadow: '0 20px 48px rgba(0,0,0,0.20)',
        }}
      >
        <div
          style={{
            fontFamily: 'Lora, serif',
            fontSize: 16,
            color: 'var(--c-ink)',
            marginBottom: 10,
            fontWeight: 500,
          }}
        >
          Trust this project's plugins?
        </div>
        <div
          style={{
            fontSize: 13.5,
            color: 'var(--c-muted)',
            lineHeight: 1.5,
            marginBottom: 14,
          }}
        >
          This project ships plugins committed to its repository. Loading them runs
          their code on your machine. Only trust plugins from a source you trust.
          Your decision is stored locally (never in the repo).
        </div>
        <ul
          style={{
            listStyle: 'none',
            margin: '0 0 20px',
            padding: 0,
            maxHeight: 180,
            overflowY: 'auto',
            border: '1px solid var(--c-hair)',
            borderRadius: 6,
          }}
        >
          {overlayPackages.map((p) => (
            <li
              key={p.package}
              style={{
                padding: '8px 12px',
                borderBottom: '1px solid var(--c-hair)',
                fontSize: 12.5,
              }}
            >
              <span style={{ color: 'var(--c-ink)', fontWeight: 500 }}>{p.package}</span>
              <span style={{ color: 'var(--c-subtle)', fontFamily: 'monospace', marginLeft: 8 }}>
                {p.origin}
              </span>
            </li>
          ))}
        </ul>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            onClick={() => decide(false)}
            disabled={busy}
            style={{
              fontSize: 12,
              padding: '6px 12px',
              borderRadius: 4,
              color: 'var(--c-muted)',
              cursor: busy ? 'not-allowed' : 'pointer',
            }}
          >
            Don't trust
          </button>
          <button
            onClick={() => decide(true)}
            disabled={busy}
            style={{
              fontSize: 12,
              padding: '6px 14px',
              borderRadius: 4,
              fontWeight: 500,
              background: 'var(--c-accent)',
              color: '#fff',
              cursor: busy ? 'not-allowed' : 'pointer',
            }}
          >
            Trust &amp; load
          </button>
        </div>
      </div>
    </div>
  );
}
