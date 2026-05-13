import { useEffect, useMemo, useState } from 'react';
import { createPatch } from 'diff';
import { usePlanVersion, usePlanVersions } from '../hooks/usePlan.js';

interface Props {
  planId: number;
  currentVersion: number;
}

export function ComparePanel({ planId, currentVersion }: Props) {
  const { data: versionsMeta } = usePlanVersions(planId);
  const versions = versionsMeta?.versions ?? [];
  const [a, setA] = useState<number>(1);
  const [b, setB] = useState<number>(currentVersion);

  useEffect(() => {
    if (versions.length > 0) {
      setA(versions[0]!.version);
      setB(versions[versions.length - 1]!.version);
    }
  }, [versions.length]);

  const { data: versionA } = usePlanVersion(planId, a);
  const { data: versionB } = usePlanVersion(planId, b);

  const patch = useMemo(() => {
    if (!versionA || !versionB) return '';
    return createPatch(`plan v${a} → v${b}`, versionA.content, versionB.content, '', '', {
      context: 3,
    });
  }, [versionA, versionB, a, b]);

  const noVersions = versions.length < 2;

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0">
      <div
        className="flex items-center gap-2 px-5 py-2"
        style={{ borderBottom: '1px solid var(--c-hair)', background: 'var(--c-bg)' }}
      >
        <VersionDropdown
          label="A"
          value={a}
          versions={versions.map((v) => v.version)}
          onChange={setA}
          disabled={noVersions}
        />
        <button
          onClick={() => {
            const tmp = a;
            setA(b);
            setB(tmp);
          }}
          disabled={noVersions}
          className="text-[11px] px-2 py-0.5 rounded btn-ghost"
          style={{ color: 'var(--c-muted)' }}
        >
          Swap
        </button>
        <VersionDropdown
          label="B"
          value={b}
          versions={versions.map((v) => v.version)}
          onChange={setB}
          disabled={noVersions}
        />
      </div>
      <div className="flex-1 overflow-auto nice-scroll p-4">
        {noVersions ? (
          <div className="text-[12.5px]" style={{ color: 'var(--c-subtle)' }}>
            Potrzebujesz co najmniej dwóch wersji, żeby porównać.
          </div>
        ) : !versionA || !versionB ? (
          <div className="text-[12.5px]" style={{ color: 'var(--c-subtle)' }}>
            Loading…
          </div>
        ) : (
          <pre
            className="font-mono text-[11.5px] leading-[1.5]"
            style={{ color: 'var(--c-ink)', whiteSpace: 'pre-wrap' }}
          >
            {renderPatch(patch)}
          </pre>
        )}
      </div>
    </div>
  );
}

function VersionDropdown({
  label,
  value,
  versions,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  versions: number[];
  onChange(v: number): void;
  disabled?: boolean;
}) {
  return (
    <label
      className="flex items-center gap-1 text-[11px] font-mono uppercase"
      style={{ color: 'var(--c-muted)' }}
    >
      {label}
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
        className="text-[12px] px-1.5 py-0.5 rounded"
        style={{
          background: 'var(--c-card)',
          border: '1px solid var(--c-hair)',
          color: 'var(--c-ink)',
        }}
      >
        {versions.length === 0 ? (
          <option value={value}>—</option>
        ) : (
          versions.map((v) => (
            <option key={v} value={v}>
              v{v}
            </option>
          ))
        )}
      </select>
    </label>
  );
}

function renderPatch(patch: string): React.ReactNode[] {
  return patch.split('\n').map((line, i) => {
    let color = 'var(--c-ink)';
    let bg = 'transparent';
    if (line.startsWith('+++') || line.startsWith('---')) {
      color = 'var(--c-muted)';
    } else if (line.startsWith('@@')) {
      color = 'var(--c-accent)';
      bg = 'var(--c-panel)';
    } else if (line.startsWith('+')) {
      color = '#2e7d4a';
      bg = 'rgba(46, 125, 74, 0.08)';
    } else if (line.startsWith('-')) {
      color = '#b33a3a';
      bg = 'rgba(179, 58, 58, 0.08)';
    }
    return (
      <div key={i} style={{ color, background: bg, padding: '0 6px' }}>
        {line || ' '}
      </div>
    );
  });
}
