import { useEffect, useRef, useState } from 'react';
import { Share2, Maximize2, Minimize2 } from 'lucide-react';
import {
  FieldLabel,
  InlineError,
  PopoverFooter,
  PopoverShell,
  SelectInput,
  TextInput,
  type PopoverFormProps,
} from '../Popover.js';
import {
  renderDiagram,
  sanitizeRenderId,
  hashSource,
} from '../../tiptap/extensions/diagramRender.js';

type PreviewState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; svg: string }
  | { status: 'error'; message: string; line?: number };

export function DiagramForm({ request, onClose }: PopoverFormProps<'diagram'>) {
  const { mode, initial } = request.props;
  const [format, setFormat] = useState<string>(initial?.format || 'mermaid');
  const [caption, setCaption] = useState<string>(initial?.caption ?? '');
  const [source, setSource] = useState<string>(initial?.source ?? '');
  const [preview, setPreview] = useState<PreviewState>({ status: 'idle' });
  const [fullscreen, setFullscreen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => {
      textareaRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    if (!source.trim()) {
      setPreview({ status: 'idle' });
      return;
    }
    setPreview({ status: 'loading' });
    debounceRef.current = window.setTimeout(() => {
      const id = sanitizeRenderId(`preview-${format}-${hashSource(source)}`);
      renderDiagram(format, source, id).then((r) => {
        if (r.ok) setPreview({ status: 'ok', svg: r.svg });
        else setPreview({ status: 'error', message: r.message, line: r.line });
      });
    }, 300);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [format, source]);

  const dirty =
    mode === 'create'
      ? source.trim().length > 0
      : format !== initial?.format ||
        caption !== (initial?.caption ?? '') ||
        source !== (initial?.source ?? '');
  const canSubmit = source.trim().length > 0 && preview.status !== 'error' && (mode === 'create' || dirty);

  function submit() {
    if (!canSubmit) return;
    onClose({ format, caption: caption.trim(), source });
  }

  function handleTextareaKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      submit();
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = e.currentTarget;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const next = source.slice(0, start) + '  ' + source.slice(end);
      setSource(next);
      window.setTimeout(() => {
        ta.selectionStart = ta.selectionEnd = start + 2;
      }, 0);
    }
  }

  const width = fullscreen ? Math.round(window.innerWidth * 0.9) : 620;
  const estHeight = fullscreen ? Math.round(window.innerHeight * 0.9) : 480;
  const x = fullscreen ? Math.round(window.innerWidth * 0.05) : request.x;
  const y = fullscreen ? Math.round(window.innerHeight * 0.05) : request.y;

  return (
    <PopoverShell
      x={x}
      y={y}
      width={width}
      estHeight={estHeight}
      onCancel={() => onClose(null)}
      title={mode === 'edit' ? 'Edit diagram' : 'New diagram'}
      icon={<Share2 size={12} style={{ color: 'var(--c-accent)' }} />}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 12,
          minHeight: fullscreen ? 'calc(90vh - 120px)' : 360,
        }}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <div style={{ width: 130 }}>
              <FieldLabel>Format</FieldLabel>
              <SelectInput value={format} onChange={(e) => setFormat(e.target.value)}>
                <option value="mermaid">Mermaid</option>
                <option value="d2" disabled title="coming soon">
                  D2 (coming soon)
                </option>
              </SelectInput>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <FieldLabel>Caption (optional)</FieldLabel>
              <TextInput value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Auth flow" />
            </div>
            <button
              onClick={() => setFullscreen((f) => !f)}
              title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              style={{
                alignSelf: 'end',
                padding: 4,
                color: 'var(--c-muted)',
                marginBottom: 2,
              }}
            >
              {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
          </div>
          <FieldLabel>Source</FieldLabel>
          <textarea
            ref={textareaRef}
            value={source}
            onChange={(e) => setSource(e.target.value)}
            onKeyDown={handleTextareaKeyDown}
            spellCheck={false}
            placeholder="flowchart TD&#10;  A[Start] --> B[End]"
            style={{
              flex: 1,
              minHeight: 220,
              width: '100%',
              padding: 8,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: 12.5,
              lineHeight: 1.45,
              color: 'var(--c-ink)',
              background: 'var(--c-bg)',
              border: '1px solid var(--c-hair)',
              borderRadius: 4,
              outline: 'none',
              resize: 'none',
              whiteSpace: 'pre',
              overflowWrap: 'normal',
              overflow: 'auto',
            }}
          />
          {preview.status === 'error' && (
            <InlineError
              message={
                preview.line !== undefined
                  ? `Line ${preview.line}: ${preview.message}`
                  : preview.message
              }
            />
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <FieldLabel>Preview</FieldLabel>
          <div
            style={{
              flex: 1,
              minHeight: 220,
              padding: 8,
              background: '#FFFBF4',
              border: '1px solid var(--c-hair)',
              borderRadius: 4,
              overflow: 'auto',
              display: 'flex',
              alignItems: preview.status === 'ok' ? 'flex-start' : 'center',
              justifyContent: 'center',
            }}
          >
            {preview.status === 'idle' && (
              <span style={{ color: 'var(--c-subtle)', fontSize: 12 }}>
                Type source to preview
              </span>
            )}
            {preview.status === 'loading' && (
              <span style={{ color: 'var(--c-subtle)', fontSize: 12 }}>Rendering…</span>
            )}
            {preview.status === 'error' && (
              <span
                style={{
                  color: 'var(--c-red, #c45a3b)',
                  fontSize: 12,
                  fontFamily: 'var(--font-mono)',
                  textAlign: 'center',
                  padding: 8,
                }}
              >
                {preview.message}
              </span>
            )}
            {preview.status === 'ok' && (
              <div
                style={{ width: '100%' }}
                dangerouslySetInnerHTML={{ __html: preview.svg }}
              />
            )}
          </div>
        </div>
      </div>
      <PopoverFooter
        onCancel={() => onClose(null)}
        onSubmit={submit}
        submitLabel={mode === 'edit' ? 'Save' : 'Insert'}
        disabled={!canSubmit}
        onRemove={mode === 'edit' ? () => onClose({ __action: 'remove' }) : undefined}
        removeLabel="Remove"
      />
    </PopoverShell>
  );
}
