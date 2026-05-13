import { Suspense, lazy } from 'react';

const MonacoEditor = lazy(() =>
  import('@monaco-editor/react').then((m) => ({ default: m.default })),
);

interface Props {
  value: string;
  onChange: (next: string) => void;
  readOnly?: boolean;
  height?: number;
}

export function MonacoJsonEditor({ value, onChange, readOnly = false, height = 240 }: Props) {
  return (
    <Suspense
      fallback={
        <textarea
          value={value}
          readOnly
          className="w-full font-mono text-[12.5px] p-2"
          style={{
            background: 'var(--c-panel)',
            color: 'var(--c-muted)',
            border: '1px solid var(--c-hair)',
            height,
          }}
        />
      }
    >
      <div
        className="rounded"
        style={{ border: '1px solid var(--c-hair)', overflow: 'hidden' }}
      >
        <MonacoEditor
          height={height}
          defaultLanguage="json"
          value={value}
          onChange={(v) => onChange(v ?? '')}
          options={{
            readOnly,
            minimap: { enabled: false },
            fontSize: 12.5,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            lineNumbers: 'off',
            folding: false,
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            tabSize: 2,
            renderLineHighlight: 'none',
            overviewRulerLanes: 0,
            hideCursorInOverviewRuler: true,
            scrollbar: { verticalScrollbarSize: 6, horizontalScrollbarSize: 6 },
          }}
        />
      </div>
    </Suspense>
  );
}
