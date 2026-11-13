import { createContext, useContext, useState } from 'react';

/**
 * M53 (2.1.87) — the images a tool returned in its result, shown in the
 * expanded tool card. Shared by EVERY card, with or without an entry in the
 * renderer registry: it hangs off the card body, not off a renderer.
 *
 * `tool_result.content` is the adapter's `JSON.stringify` of the SDK content
 * array — the same string live and from `chat_message` history — so one parser
 * serves both sources:
 *   [{"type":"text","text":"…"},{"type":"image","source":{"type":"base64","media_type":"image/png","data":"…"}}]
 */

/**
 * Raster types only, as an allow-list: anything else — `image/svg+xml` above
 * all, which can carry scripts and external references — is never rendered.
 * The result is agent data, so it is untrusted.
 */
export const RASTER_IMAGE_TYPES: ReadonlySet<string> = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

export type ResultBlock =
  | { kind: 'text'; text: string }
  | { kind: 'image'; mediaType: string; data: string }
  | { kind: 'bad-image' };

/**
 * The result's blocks in their original order, or `null` when the result holds
 * no image block — a text-only result keeps the card exactly as it was.
 */
export function parseResultBlocks(raw: string | null | undefined): ResultBlock[] | null {
  if (!raw) return null;
  let outer: unknown;
  try {
    outer = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(outer) || !outer.some((b) => isRecord(b) && b.type === 'image')) return null;
  const blocks: ResultBlock[] = [];
  for (const b of outer) {
    if (!isRecord(b)) continue;
    if (b.type === 'text' && typeof b.text === 'string') blocks.push({ kind: 'text', text: b.text });
    else if (b.type === 'image') blocks.push(toImageBlock(b.source));
  }
  return blocks;
}

function toImageBlock(source: unknown): ResultBlock {
  if (!isRecord(source) || source.type !== 'base64') return { kind: 'bad-image' };
  // The SDK writes `media_type`; agent-chat's own blocks use `mediaType`.
  const mediaType = source.media_type ?? source.mediaType;
  if (typeof mediaType !== 'string' || !RASTER_IMAGE_TYPES.has(mediaType.toLowerCase())) return { kind: 'bad-image' };
  if (typeof source.data !== 'string') return { kind: 'bad-image' };
  const data = source.data.replace(/\s+/g, '');
  if (!data || !decodesAsBase64(data)) return { kind: 'bad-image' };
  return { kind: 'image', mediaType: mediaType.toLowerCase(), data };
}

function decodesAsBase64(data: string): boolean {
  try {
    atob(data);
    return true;
  } catch {
    return false;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/**
 * Which results of the open turn were degraded in the replay buffer (shown as
 * the truncation marker until the turn ends), and the content fetched from
 * thread history for them once it has (`useChat`).
 */
export interface ToolResultReplayState {
  degraded: ReadonlySet<string>;
  overrides: ReadonlyMap<string, string>;
}

export const EMPTY_TOOL_RESULT_REPLAY: ToolResultReplayState = { degraded: new Set(), overrides: new Map() };

export const ToolResultReplayContext = createContext<ToolResultReplayState>(EMPTY_TOOL_RESULT_REPLAY);

export function useToolResultReplay(): ToolResultReplayState {
  return useContext(ToolResultReplayContext);
}

export function TruncatedResultMarker() {
  return (
    <div className="mt-1.5 text-[12px] italic" style={{ color: 'var(--c-subtle)' }} data-tool-result="truncated">
      Result truncated in replay — it will load when the turn finishes.
    </div>
  );
}

interface Props {
  blocks: ResultBlock[];
  onOpenRawJson: () => void;
}

export function ToolResultContent({ blocks, onOpenRawJson }: Props) {
  return (
    <div className="mt-1.5 flex flex-col gap-1.5" data-tool-result="blocks">
      {blocks.map((b, i) =>
        b.kind === 'text' ? (
          <div key={i} className="text-[12.5px] whitespace-pre-wrap break-words" style={{ color: 'var(--c-ink)' }}>
            {b.text}
          </div>
        ) : b.kind === 'image' ? (
          <ResultImage key={i} mediaType={b.mediaType} data={b.data} onOpenRawJson={onOpenRawJson} />
        ) : (
          <ImageFallback key={i} onOpenRawJson={onOpenRawJson} />
        ),
      )}
    </div>
  );
}

function ResultImage({ mediaType, data, onOpenRawJson }: { mediaType: string; data: string; onOpenRawJson: () => void }) {
  // `atob` accepts data the browser still cannot decode as an image.
  const [failed, setFailed] = useState(false);
  if (failed) return <ImageFallback onOpenRawJson={onOpenRawJson} />;
  return (
    <img
      src={`data:${mediaType};base64,${data}`}
      alt="Tool result image"
      style={{ maxWidth: '100%', height: 'auto', display: 'block' }}
      onError={() => setFailed(true)}
    />
  );
}

function ImageFallback({ onOpenRawJson }: { onOpenRawJson: () => void }) {
  return (
    <div className="text-[12px]" style={{ color: 'var(--c-subtle)' }} data-tool-result="image-fallback">
      Image could not be displayed{' '}
      <button type="button" className="underline" style={{ color: 'var(--c-accent)' }} onClick={onOpenRawJson}>
        open raw JSON
      </button>
    </div>
  );
}
