import crypto from 'node:crypto';
import matter from 'gray-matter';
import { canonicalize } from '../serialization/snapshot.js';

/**
 * M42 — the two format adapters, and the whole of what a format is allowed to
 * know.
 *
 * An adapter answers exactly three questions: how a record becomes bytes, how
 * bytes become a record, and what the CANONICAL hash of those bytes is. Hashing
 * belongs here because `expectedHash` and a version snapshot's content have to
 * come from one computation — otherwise two copies of an identical file could
 * compare as different.
 *
 * An adapter does NOT own path resolution, the conflict check, atomicity,
 * suppression, the phase chain or the shape of the response. All six live in
 * the primitive, once.
 *
 * There is no third adapter, and none is designed ahead of need: a third one
 * arrives when a third content store does.
 */

export interface RecordFormatAdapter<T> {
  readonly format: 'markdown' | 'json';
  /** Record → bytes. The only step in the whole write where format matters. */
  serialize(record: T): string;
  deserialize(bytes: string): T;
  /** Canonical digest over the ACTUAL on-disk bytes. */
  hash(bytes: string): string;
}

function sha256(bytes: string): string {
  return crypto.createHash('sha256').update(bytes, 'utf-8').digest('hex');
}

/**
 * A markdown record: frontmatter plus body, or `raw` bytes to be written
 * verbatim.
 *
 * `raw` exists for one caller and one reason — M17's version restore has to put
 * back exactly the bytes it captured. Going through `matter.stringify` would
 * normalise frontmatter key order and quoting and append a trailing newline, so
 * a restored file would no longer compare equal to its own snapshot and every
 * repeat restore would mint a fresh version row.
 */
export type MarkdownRecord =
  | { raw: string; frontmatter?: undefined; body?: undefined }
  | { raw?: undefined; frontmatter?: Record<string, unknown>; body: string };

/**
 * Markdown with optional frontmatter. XML tags are written LITERALLY and never
 * expanded — a tag is an edge, and expanding it pastes a payload in where the
 * edge was.
 *
 * Serialization matches M02's historical behaviour byte for byte: frontmatter is
 * emitted only when it has keys, so a page without one stays a bare body. The
 * hash is `sha256(content)` in hex over frontmatter + body together, which is
 * the value `expectedHash` has always been compared against.
 */
export const markdownAdapter: RecordFormatAdapter<MarkdownRecord> = {
  format: 'markdown',
  serialize(record) {
    if (record.raw !== undefined) return record.raw;
    const fm = record.frontmatter;
    return fm && Object.keys(fm).length > 0 ? matter.stringify(record.body, fm) : record.body;
  },
  deserialize(bytes) {
    const parsed = matter(bytes);
    return { frontmatter: (parsed.data ?? {}) as Record<string, unknown>, body: parsed.content };
  },
  hash: sha256,
};

/**
 * Deterministic JSON — stable key order, stable indentation, trailing newline.
 *
 * Determinism is the invariant, not a nicety: any non-deterministic field would
 * produce git-diff noise on every rebuild, and a round-trip that is not
 * byte-for-byte would make the file→index→file fixpoint untestable.
 */
export const jsonAdapter: RecordFormatAdapter<unknown> = {
  format: 'json',
  serialize(record) {
    return JSON.stringify(canonicalize(record), null, 2) + '\n';
  },
  deserialize(bytes) {
    return JSON.parse(bytes) as unknown;
  },
  hash: sha256,
};
