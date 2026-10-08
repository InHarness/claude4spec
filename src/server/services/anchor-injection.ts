import { customAlphabet } from 'nanoid';
import { ANCHOR_PATTERN_SOURCE } from '../../shared/anchor-pattern.js';
import { insertAnchorLines, parseSections } from '../../shared/section-parser.js';
import { ARTIFACT_ROOT_KIND, type ArtifactKind } from './artifact-registry.js';
import { kindSelects } from '../../shared/root-kinds.js';
import type { MarkdownFileStore } from './markdown-file-store.js';
import type { WatchSubscriber } from '../fs/watcher.js';

/**
 * M06 (2.0.0) — anchor injection for chat ARTIFACTS, owned by the sections
 * module. Until 2.0.0 the implementation lived in the artifact write path
 * (`PlanService.update` and a mount subscriber built in `project-context`), with
 * its own heading regex and its own fence toggle. It now sits beside the rest of
 * the section machinery and reads headings from the shared section parser, so a
 * `## X` inside a code block or a multi-line HTML comment never gets an anchor
 * — and an injected one-line anchor comment can no longer land INSIDE a
 * multi-line comment, where its `-->` used to close the outer comment early and
 * expose the rest as page content.
 *
 * The artifact registry only DECLARES who gets anchors (`anchorInjection`):
 * today plans alone. Briefs and patches never do. No artifact kind enters
 * `section_index` — artifact anchors are unique within their file only.
 */

// Generator stays strict 8 (M06 `15u7sazr` — auto-inject contract).
const nanoid8 = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 8);

/** Plans anchor `##`–`####`: `#` is the plan title, deeper levels are detail. */
const MIN_LEVEL = 2;
const MAX_LEVEL = 4;

/**
 * Mint an anchor free WITHIN THIS FILE. The uniqueness scope of an artifact
 * anchor is the file it lives in — never `section_index`, which indexes page
 * roots and which artifacts are deliberately absent from.
 */
function mintFileAnchor(taken: Set<string>): string {
  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = nanoid8();
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
  throw new Error('[anchor-injection] could not mint a free anchor in 8 attempts');
}

/**
 * Put an anchor comment above every `##`–`####` heading of `body` that has none.
 * `body` carries no frontmatter. Returns the body unchanged when nothing was
 * missing.
 */
export function injectArtifactAnchors(body: string): string {
  const sections = parseSections(body, { frontmatter: false }).sections;
  const missing = sections.filter((s) => s.anchor === null && s.level >= MIN_LEVEL && s.level <= MAX_LEVEL);
  if (missing.length === 0) return body;
  // Seeded with every anchor-shaped value in the file, code included: an
  // injected value must never duplicate anything a reader could mistake for it.
  const taken = new Set<string>();
  for (const m of body.matchAll(new RegExp(ANCHOR_PATTERN_SOURCE, 'g'))) taken.add(m[1]!);
  return insertAnchorLines(body, missing, missing.map(() => mintFileAnchor(taken)));
}

/**
 * Whether a file write of this artifact kind gets anchors — 2.1.8: its root
 * kind selects `m06-anchor-injection` (plans do; briefs and patches do not).
 */
export function injectsAnchors(kind: ArtifactKind): boolean {
  return kindSelects(ARTIFACT_ROOT_KIND[kind], 'm06-anchor-injection');
}

/**
 * The injection for one artifact write: anchors for kinds that declare
 * `anchorInjection`, the body untouched for every other kind.
 */
export function injectAnchorsFor(kind: ArtifactKind, body: string): string {
  return injectsAnchors(kind) ? injectArtifactAnchors(body) : body;
}

/**
 * Trigger two of two: a write-back subscriber on an artifact mount, for files
 * written OUTSIDE the artifact service (an agent or a user editing the plan file
 * on disk). Trigger one is the service's own synchronous call to
 * {@link injectAnchorsFor}, which a following write must see with no debounce
 * window in between.
 */
export function artifactAnchorInjectionSubscriber(
  kind: ArtifactKind,
  mount: { store: MarkdownFileStore },
  suppress: (source: string, relPath: string) => void,
): WatchSubscriber {
  return {
    onChange: async (_scope, source, relPath) => {
      if (!injectsAnchors(kind)) return;
      let page;
      try {
        page = await mount.store.read(relPath);
      } catch {
        return; // already gone — skip idempotently
      }
      const injected = injectArtifactAnchors(page.body);
      if (injected === page.body) return;
      suppress(source, relPath);
      await mount.store.write(relPath, { frontmatter: page.frontmatter, body: injected });
    },
    onUnlink: () => {},
  };
}
