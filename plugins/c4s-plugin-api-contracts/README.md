# c4s-plugin-api-contracts

The pilot **builtin envelope**: a real plugin package that lives inside the
claude4spec repository. It contributes the `endpoint` and `dto` entity types and
the `endpoint_dto` junction that couples them.

It is discovered and registered through the ordinary M33 loader — never through
the host's `registerAllPlugins` — and is trusted by virtue of living in the host
repo, so it sits outside the `trustProjectPlugins` gate that covers project-local
plugins.

## Why both types are in one package

The junction carries a foreign key to each of them, and the reads that populate
`linked_dtos` join across both tables. A package owning only one side would have
to reach into the other's schema, or push the join back onto the host — which is
the arrangement release 0.2.2 exists to remove.

## Building

    npm run build:envelopes      # from the repo root
    npm run dev:envelopes        # vite build --watch, from the repo root

Output goes to the HOST's `dist/plugins/c4s-plugin-api-contracts/`, not to a
`dist/` beside this source. That is deliberate and load-bearing: everything that
packages this project copies `dist/` and only `dist/` — the npm tarball via
`package.json#files`, container images via `COPY /app/dist`. An artifact anywhere
else is silently absent at runtime.

**A backend change needs a host restart.** Both dev and prod load the built
`index.js` through a `file://` URL, which is outside `tsx watch`'s graph, so
editing backend source here will not hot-reload the running server. Frontend
changes are picked up on reload once `dev:envelopes` has rebuilt.

## Extraction

Moving this package to its own repository is `git mv` plus a `package.json`. No
import in `src/` changes. Three things would need adjusting, all outside `src/`:

1. `tsconfig.json`'s `paths` for `@c4s/plugin-runtime` become the standard
   `/// <reference types="@inharness-ai/claude4spec/plugin-runtime/ambient" />`,
   resolved through an `@inharness-ai/claude4spec` devDependency;
2. `vite.config.ts`'s `outDir` points back at a local `dist/`;
3. the scaffold's `scripts/bundle-backend-deps.mjs` pass gets added, since an
   externally-loaded plugin cannot resolve `express`/`zod` from the host's
   `node_modules` the way an in-repo package can.

## What is vendored, and why

`src/host-kit/` and `src/frontend-kit/` hold copies of host code that the
published `@c4s/plugin-runtime` surface does not export — `BaseEntityCrudService`,
`DomainError`, the slug rules, the list-screen and popover-form primitives.
Each file says why it is a copy rather than an import. The short version: an
envelope must compile against `@c4s/plugin-runtime` alone, and rewriting these
two services to the sanctioned crud-adapter pattern would have violated the
byte-identical-serialization criterion this release ships under.

The gaps are filed as a patch against the spec; as they are closed, the copies
should shrink.
