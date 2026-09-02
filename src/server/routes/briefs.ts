import { Router } from 'express';
import type { BriefService } from '../services/brief.js';
import type { ChatService, ArtifactThreadColumn } from '../services/chat.js';
import { artifactRegistry } from '../services/artifact-registry.js';
import { DomainError } from '../services/tags.js';

/**
 * M21 — brief creation stays outside the M36 generic artifact family (the
 * brief itself notes: "Endpointy, które pozostają w slice'ach konsumentów" —
 * POST /api/briefs is the one brief-specific creation flow that doesn't
 * generalize). Everything else (list/detail/versions/content/frontmatter/
 * threads) moved to `GET/PUT/PATCH/POST /api/artifacts/brief/*` — see
 * `routes/artifacts.ts`.
 */
export function briefsRouter(briefs: BriefService, chat: ChatService): Router {
  const router = Router();

  // POST /api/briefs — create
  router.post('/', async (req, res, next) => {
    try {
      const body = (req.body ?? {}) as {
        fromReleaseName?: string | null;
        toReleaseName?: string | null;
        additionalPrompt?: string;
        suffix?: string;
        roots?: string[];
      };
      // 0.2.64: no provenance selector on the wire. The payload says which end
      // of the window is open and nothing else, so it cannot contradict itself:
      // `fromReleaseName === null` ⇒ open at the start (no previous release),
      // `toReleaseName === null`   ⇒ open to the current state.
      const fromIsValid =
        body.fromReleaseName === null ||
        body.fromReleaseName === undefined ||
        typeof body.fromReleaseName === 'string';
      const toIsValid =
        body.toReleaseName === null ||
        body.toReleaseName === undefined ||
        typeof body.toReleaseName === 'string';
      if (!fromIsValid || !toIsValid) {
        throw new DomainError(
          'VALIDATION',
          'fromReleaseName/toReleaseName must be a string or null',
        );
      }
      // Forwarded VERBATIM — `undefined` and `null` are different windows here
      // (`undefined` ⇒ the latest release, `null` ⇒ open at the start), so
      // collapsing them with `?? null` would silently rewrite the request.
      const fromName = body.fromReleaseName;
      const toName = body.toReleaseName;
      // 0.1.96 (M21/L13) brief scope: an array of root ids the brief covers.
      // Absent / empty ⇒ whole-release (createBrief omits the `roots` frontmatter
      // + slug segment). A non-array or non-string entry is a client bug → 400.
      let roots: string[] | undefined;
      if (body.roots !== undefined) {
        if (!Array.isArray(body.roots) || body.roots.some((r) => typeof r !== 'string')) {
          throw new DomainError('VALIDATION', 'roots must be an array of root id strings');
        }
        roots = body.roots.length > 0 ? body.roots : undefined;
      }
      // roots is a dead field once the window's `to` end is open — enforced
      // inside `createBrief` itself (shared by this route and any in-process
      // caller), not duplicated here.
      // 0.1.69: file-only createBrief + createThreadForBrief — the UI "New brief"
      // action still gets its initial editorial thread. `additionalPrompt` is a
      // client concern (appended to the first user message after redirect), not
      // persisted server-side.
      // `resolvedFromName` may differ from `fromName` — `createBrief` expands an
      // OMITTED `fromReleaseName` to the latest release.
      const {
        briefPath,
        fromReleaseName: resolvedFromName,
        toReleaseName: resolvedToName,
      } = await briefs.createBrief({
        fromReleaseName: fromName,
        toReleaseName: toName,
        suffix: typeof body.suffix === 'string' ? body.suffix : undefined,
        roots,
      });
      // The title names the window, since that is all the provenance there is.
      const threadTitle =
        resolvedToName === null
          ? `Brief: ${resolvedFromName ?? 'HEAD'} → (unreleased)`
          : resolvedFromName === null
            ? `Initial brief: ${resolvedToName}`
            : `Brief: ${resolvedFromName} → ${resolvedToName}`;
      const { threadId: initialThreadId } = briefs.createThreadForBrief({
        path: briefPath,
        name: threadTitle,
      });
      // Odpowiedz to pelny `BriefResponse` — ten sam ksztalt co detal briefu,
      // plus `threads`. Watek zalozony wyzej jest top-level, wiec konsument
      // (m.in. `runAgent` create-mode) bierze go jako `threads[0].id`; osobne
      // pole na id watku nie istnieje.
      const brief = await briefs.getBrief(briefPath);
      const listed = chat.listThreadsByArtifact({
        threadColumn: artifactRegistry.brief.binding.threadColumn as ArtifactThreadColumn,
        path: briefPath,
        limit: 20,
        offset: 0,
      });
      // Kolejnosc listy to `updated_at DESC, id DESC`, a `updated_at` ma
      // rozdzielczosc sekundy — brief odtworzony pod ta sama sciezka (wiersze
      // chat_thread przezywaja skasowany plik) moglby wystawic na threads[0]
      // stary watek. Id z `createThreadForBrief` jest jednoznaczne, wiec ten
      // watek wychodzi na czolo listy.
      const threads = [
        ...listed.filter((t) => t.id === initialThreadId),
        ...listed.filter((t) => t.id !== initialThreadId),
      ];
      res.json({ data: { ...brief, threads } });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
