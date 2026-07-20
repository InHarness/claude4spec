# Docker test environment

Runs claude4spec in a container against an isolated fixture project (not your
local `.claude4spec`/`pages`), for manually testing changes end-to-end.

## Build modes

`@inharness-ai/agent-adapters` and `@inharness-ai/agent-chat` — the packages
that implement the agent runtime — are normally linked to local sibling
checkouts (`file:../agent-adapters`, `file:../agent-chat`). The image can be
built two ways:

- **`registry`** (default) — installs those two packages from npm, matching
  a real release.
- **`local`** — installs them from `../agent-adapters` and `../agent-chat`
  (the directories next to this repo), so uncommitted/proposed changes to
  the agent runtime are actually exercised.

```bash
docker/build.sh registry   # -> claude4spec-test:registry
docker/build.sh local      # -> claude4spec-test:local (needs ../agent-adapters, ../agent-chat to exist)
```

## Running

First, provision the environment's runtime directories (creates them empty
on first run, or seeds them from `docker/environments/<name>/seed/` if that
exists — safe to re-run, a no-op once already provisioned):

```bash
docker/setup-env.sh              # env 'default', both registry and local modes
docker/setup-env.sh myenv        # a different named environment
docker/setup-env.sh --reset      # wipe + reseed 'default'
```

```bash
docker run --rm -p 3000:3000 \
  -e ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
  -v "$(pwd)/docker/environments/default/runtime/registry/data:/data" \
  -v "$(pwd)/docker/environments/default/runtime/registry/workspace:/workspace" \
  claude4spec-test:registry
```

Then open `http://localhost:3000/welcome`.

Or with Compose (bind mounts from `docker/environments/<name>/runtime/`, one
service per mode):

```bash
docker compose up app-registry
docker compose up app-local
C4S_ENV=myenv docker compose up app-registry   # a non-default environment
```

### Env vars

- `ANTHROPIC_API_KEY` — optional. If set, agent chat turns authenticate
  headlessly with this key (no `claude login` needed inside the container —
  it takes precedence over local OAuth). Without it, agent chat only works
  if a credential was already saved through the app's own Settings UI, or if
  your local OAuth session is bind-mounted in — see "Using your local Claude
  Code login instead of ANTHROPIC_API_KEY" below.
- `PORT` — server port (default `3000`).
- `PROJECT_DIR` — path inside the container for the fixture project
  (default `/workspace/project`).
- `C4S_ENV` — selects which `docker/environments/<name>/` runtime to
  bind-mount (default `default`). Only affects `docker compose up`; must
  match the name passed to `docker/setup-env.sh`.
- `PORT_HOST` — host-side port for `docker compose up` (default `3000`,
  container-internal port always stays `3000`). Bump this to run a second
  environment concurrently (e.g. a second git worktree's smoke-test)
  without a port clash.
- `AGENT_ADAPTERS_DIR` / `AGENT_CHAT_DIR` — advanced override for where
  `local` mode's sibling checkouts live. `docker/setup-env.sh` auto-derives
  and persists sensible defaults into `.env` (the true siblings of the
  *main* repo checkout, resolved via git even from inside a worktree) —
  only set these yourself if the checkouts live somewhere non-standard.

### Volumes

Bind-mounted from `docker/environments/<name>/runtime/` (name from
`C4S_ENV`, default `default`) rather than opaque Docker-managed volumes, so
the registry JSON, SQLite DBs, and bootstrapped project files are visible
and inspectable directly on the host:

- `docker/environments/<name>/runtime/<mode>/data` → `/data` (`C4S_HOME`):
  the workspace registry (`workspaces.json`) + per-project SQLite DBs.
- `docker/environments/<name>/runtime/<mode>/workspace` → `/workspace`:
  holds the fixture project (`/workspace/project` by default). Deliberately
  **not** a bind mount of your real repo — the container always gets an
  independent, disposable project. `<mode>` is `registry` or `local`,
  matching the two Compose services, so they never share state and can run
  concurrently.

Run `docker/setup-env.sh` before first use (see "Running" above) — Compose
can create empty bind-mount directories on its own but can't seed content
into them. On first provisioning the project directory is either copied
from `docker/environments/<name>/seed/project/` (if that exists) or left
empty; an empty project is bootstrapped automatically on container start
(empty project, no prompts) exactly as before. Restarting against the same
runtime directories reuses them instead of re-bootstrapping — bootstrap is
idempotent, and `setup-env.sh` itself is a no-op once a project directory
already exists (short of `--reset`).

Delete the runtime directory (or run `docker/setup-env.sh <name> --reset`)
for a fully throwaway run that resets on next start.

## Adding another environment

To add a second named environment (e.g. `myenv`) alongside `default`:

1. Create `docker/environments/myenv/seed/project/` and, if you want
   pre-populated fixture content, add `pages/*.md` and/or `.claude4spec/...`
   under it (already un-ignored for this path — see `.gitignore`). Leave it
   empty/absent for a plain bootstrap-from-scratch environment.
2. `docker/setup-env.sh myenv` to provision `docker/environments/myenv/runtime/`.
3. `C4S_ENV=myenv docker compose up app-registry` (or `app-local`).

No changes to `docker-compose.yml` or `setup-env.sh` are needed — both are
parameterized by environment name already.

## Using from a git worktree

Everything above works unchanged from inside a git worktree (e.g. one
created by a brief-implementation workflow under `.worktrees/<slug>/`),
with two things to know:

- Each worktree gets its own, fully isolated
  `docker/environments/<name>/runtime/` — paths resolve relative to that
  worktree's own copy of the repo, so different worktrees never share or
  clobber each other's test-project state.
- **The Docker files themselves must be committed** for a worktree to see
  them at all — `git worktree add ... origin/main` only brings along
  committed content. If you're testing this from an uncommitted checkout,
  Docker won't exist yet in any worktree branched from it.
- `local` mode's sibling checkouts (`AGENT_ADAPTERS_DIR`/`AGENT_CHAT_DIR`)
  are resolved relative to the **main** repo root regardless of worktree
  nesting (via `git rev-parse --git-common-dir`), not the worktree's own
  parent directory — so `docker/build.sh local` / `docker compose build
  app-local` work the same from a worktree as from the main checkout.
- Use `PORT_HOST` to run more than one worktree's container at once (see
  Env vars above).

## Plugin smoke-testing (project-local overlay)

Lets a plugin author smoke-test their built `.claude4spec/plugins/<name>/`
package against a real running host, without rebuilding this image and
without clicking through the Trust Plugins UI. Uses the SAME project-local
overlay mechanism a real trusted repo uses
(`src/server/core/plugin-host/overlay-loader.ts`) — nothing Docker-specific
about plugin *loading*, only about how trust and the mount get wired up
non-interactively. The intended caller is `docker/plugin-smoke.sh` in a
plugin's own repo (e.g. `c4s-plugin-scaffold`), not something you normally
run by hand.

```bash
docker/setup-plugin-env.sh myplugin --entity-type=my-plugin:widget
PLUGIN_ROOT=/absolute/path/to/my-plugin-package \
PLUGIN_MOUNT_NAME=my-plugin \
C4S_ENV=myplugin PORT_HOST=3002 \
  docker compose -f docker-compose.yml -f docker-compose.plugin.yml up -d app-registry
```

Then poll `http://localhost:3002/api/projects/<id>/_meta/plugins` for your
package's entry in `packages[]` with `status: "loaded"` (not `"failed"` /
`"incompatible"` / `"skipped"`) and top-level `trust: true` — and
`http://localhost:3002/api/projects/<id>/_meta/entities` for your type(s)
under `active`, not `inactive`/`unknown`. `<id>` is deterministic:
`sha1("/workspace/project")` truncated to 12 hex chars, since `PROJECT_DIR`
is always that fixed path inside the container.

Trust is set by `docker/setup-plugin-env.sh` calling `c4s trust-plugins`
directly against the environment's `/data`-backed registry file, **before**
`docker compose up` ever starts a container — not by an env var read inside
the running server. This keeps the non-interactive trust bypass out of the
production server's boot path entirely (it's a one-off CLI mutation of
`workspaces.json`, not a passively-checked flag in `src/server/index.ts`).

### What must be true of your `dist/`

- `PLUGIN_ROOT` must point at a directory containing `package.json` at its
  root (not `dist/` itself) — the host resolves the entry via
  `package.json`'s `main`/`module`/`exports`, falling back to
  `index.{js,mjs,cjs}`, exactly as for a real committed overlay.
- **Your `dist/` must be fully self-contained — the host does not run `npm
  install` against the mounted directory, on Docker or otherwise.** An
  overlay package is loaded with a raw Node `import()` of the resolved entry
  file; there is no `NODE_PATH`, symlink, or other bridge to this host's own
  `node_modules`. This is a property of the overlay mechanism itself, not a
  Docker limitation — the exact same failure would occur running this host
  bare-metal against a real project directory elsewhere on disk. Any runtime
  dependency your plugin's backend entry imports beyond Node builtins must be
  bundled into `dist/` (e.g. don't mark pure-JS backend deps like `express`
  as Rollup/esbuild `external`). A dependency left unbundled
  resolves to nothing and the package record comes back `status: "failed"`.
  - **Build any schema the host introspects with the facade `z`, not a bundled
    `zod`** (0.1.134→next): import it as `import { z } from '@c4s/plugin-runtime'`.
    A `backend.crud` create/update schema, or a `zodShape` passed to `mcpTool`,
    is later introspected by the host with `z.toJSONSchema()` (a **zod v4** API
    that walks each schema node's internal `.def`). A schema built by a *second*
    zod instance — whether bundled into `dist/`, or left as a bare `import { z }
    from 'zod'` — has no v4-shaped `.def`, so the host throws `Cannot read
    properties of undefined (reading 'def')` and `describe_entity_type` degrades
    to an error placeholder for that type. Only the facade `z` is the host's
    single instance; there is **no** host resolver for a bare `import 'zod'`, so
    marking `zod` `external` and importing it bare resolves to nothing at runtime
    (`status: "failed"`) — always name `@c4s/plugin-runtime`. The host is on
    **zod v4**; schema code written against v3 APIs may need adjustment. (zod you
    use for your own internal, non-schema validation that the host never sees can
    still be bundled normally.)
- **Native modules (e.g. `better-sqlite3`) are not supported by this
  mechanism today** — there's no way to bundle a compiled `.node` binary the
  same way, and there is no backend equivalent of the frontend's
  import-map peer-sharing shim (`runtime-shims.ts`/`buildImportMap`, which
  only covers browser-side peers like `react`/`@tiptap/core`). If your
  plugin needs a native backend dependency, it isn't usable via the overlay
  mechanism until that gap is addressed — file a separate issue rather than
  working around it here.
- Frontend-facing peer imports (`react`, `react-dom`, `@c4s/plugin-runtime`,
  etc.) ARE provided by the host's import-map shim for the *browser* bundle
  — but that shim has no bearing on the *backend* entry's Node `import()`.
- **`@c4s/plugin-runtime` is the one exception on the backend** (0.1.134): the
  M33 loader installs a host-owned resolver at bootstrap, so your backend entry
  may import the bare alias and will get the host's *live* facade — the same
  instance the host itself uses, not a bundled copy. Do NOT bundle it. It
  carries the MCP builders (`createMcpServer`/`mcpTool`, for the
  `backend.mcpServer` slot), the host's `z` (0.1.134→next — use it to build any
  schema the host introspects, per the `zod` note above) and `HOST_API_VERSION`;
  `@c4s/plugin-runtime/ui`
  resolves to the React-free contract (the `stable` component names). Per-project
  things (db, host services) arrive through `MountContext`, not this alias.
  Build it as an `external`, and prefer it over naming
  `@inharness-ai/agent-adapters` yourself — a direct vendor import means
  ERESOLVE peer conflicts on install, two vendor copies in one process, and a
  plugin that works locally but throws (e.g. `AdapterInitError`) against a host
  whose vendor moved.
  - Fallback: on node <20.6 (`engines.node` still admits it) the resolver can't
    install, warns, and the bare alias fails as before — import
    `@inharness-ai/claude4spec/plugin-runtime` instead.
- `hostApiVersion` in your manifest must satisfy this build's
  `HOST_API_VERSION` (`src/shared/plugin-host/manifest.ts`) — a major
  mismatch reports `status: "incompatible"` with a migration descriptor.

### Env vars (additive — see also the table above)

| Var | Required | Meaning |
|---|---|---|
| `PLUGIN_ROOT` | yes | Host path to your plugin's package root (`package.json` + `dist/`). |
| `PLUGIN_MOUNT_NAME` | no (default `plugin`) | Subdirectory name under `.claude4spec/plugins/` — cosmetic only, shows up in `/_meta/plugins` diagnostics. |

### Caveats

- Don't override `PROJECT_DIR` together with `docker-compose.plugin.yml` —
  the mount target path is hardcoded to
  `/workspace/project/.claude4spec/plugins/...`.
- `docker/setup-plugin-env.sh`'s `config.json` whitelist patch is a no-op on
  a brand-new environment (no `entities` key = all plugin types already
  active by default) — it only matters when reusing/seeding an environment
  that already narrows `entities`.
- Don't rely on hot-reload after rebuilding your plugin's `dist/` — Docker
  bind-mount file-watch propagation (especially Docker Desktop/macOS) isn't
  guaranteed to fire the host's `chokidar` watcher. Recreate the container
  (`docker compose up -d --force-recreate app-registry`, or just re-run
  `plugin-smoke.sh`) after every rebuild instead of expecting a live reload.
- The version-gate for a caller in another repo is simply the presence of
  `docker-compose.plugin.yml` in this checkout — no separate API version
  field. If that file is missing, the checkout predates this feature.

## Verifying a code change

1. Rebuild: `docker/build.sh registry` (or `local`).
2. Run it (see above) and confirm the editor loads at `/welcome` or the
   project URL printed in `docker logs`.
3. For `local` mode specifically: after changing `../agent-adapters` or
   `../agent-chat`, remember those packages ship pre-built — rebuild that
   sibling package itself (its own `npm run build`) before rebuilding this
   image, otherwise the container still runs the old `dist/`.

## Testing Git Sync (M28)

The runtime image includes the `git` binary, so a container can satisfy
`GitService`'s (`src/server/services/git.ts`) repo detection — the sole git
shell-out in the server, powering the Git settings section and `GET
/api/git/status`. The fixture project isn't a git repo by default; initialize
one inside a running container with:

```bash
docker exec <container> init-git.sh
# or, with Compose:
docker compose exec app-registry init-git.sh
```

This runs `git init` against `$PROJECT_DIR`, configures a commit identity,
and makes an initial commit — idempotent, safe to re-run (a no-op once the
project is already a repo). Override the commit identity with:

```bash
docker exec -e GIT_AUTHOR_NAME="Your Name" -e GIT_AUTHOR_EMAIL="you@example.com" \
  <container> init-git.sh
```

After running it, the app's Settings → Git section (and `GET
/api/git/status`) should report a detected repo instead of the "not inside a
git repository" empty state. No remote is configured, so push-sync will
correctly report no upstream — this is only meant for exercising
detect/commit locally.

## Using your local Claude Code login instead of ANTHROPIC_API_KEY

Agent turns need Anthropic credentials. The simplest option is `-e
ANTHROPIC_API_KEY=...` (see "Env vars" above). To instead reuse your
existing `claude login` session from the host, bind-mount your local OAuth
files read-only into the container:

```bash
docker compose -f docker-compose.yml -f docker-compose.creds.yml up app-registry
```

Or with plain `docker run`:

```bash
docker run --rm -p 3000:3000 \
  -v "$(pwd)/docker/environments/default/runtime/registry/data:/data" \
  -v "$(pwd)/docker/environments/default/runtime/registry/workspace:/workspace" \
  -v ~/.claude.json:/root/.claude.json:ro \
  -v ~/.claude/.credentials.json:/root/.claude/.credentials.json:ro \
  claude4spec-test:registry
```

This works because the container runs as `root` (`$HOME=/root`, no `USER`
directive in `docker/Dockerfile`), matching where
`@anthropic-ai/claude-agent-sdk` looks for `.claude.json` / `.claude/.credentials.json`
by default. If `ANTHROPIC_API_KEY` is also set, it takes precedence over the
mounted OAuth session. Mounts are read-only — a token refresh inside the
container won't propagate back to your host files; if your session expires
mid-run, refresh it on the host and restart the container. Note
`~/.claude.json` holds your whole local Claude Code config (all projects,
not just this one), not just an auth token.

## Troubleshooting: "Native CLI binary ... not found"

If starting an agent turn fails with something like:

> Failed to initialize claude-code adapter: Native CLI binary for
> linux-arm64 not found. Reinstall @anthropic-ai/claude-agent-sdk without
> --omit=optional, or set options.pathToClaudeCodeExecutable.

this is almost always a **stale image** — `@anthropic-ai/claude-agent-sdk`
ships its CLI binary as a platform-specific optional dependency, and either
an old image tag was never rebuilt after a dependency change, or `docker
compose up` reused an existing image without rebuilding (Compose doesn't
rebuild automatically). Rebuild without cache:

```bash
docker build --no-cache -f docker/Dockerfile --build-arg DEPS_MODE=registry -t claude4spec-test:registry .
# or: docker compose build --no-cache app-registry && docker compose up app-registry
```

The image now fails the build itself (not just at agent-start time) if the
native binary for the target platform can't be resolved, so a fresh rebuild
either fixes this outright or fails loudly with the same root cause instead
of silently shipping a broken image.

## Cleanup

```bash
docker rm -f <container>
docker rmi claude4spec-test:registry claude4spec-test:local
rm -rf docker/environments/default/runtime      # or: docker/setup-env.sh --reset

# plugin smoke-test environment, additionally scoped by C4S_ENV:
docker compose -f docker-compose.yml -f docker-compose.plugin.yml down
```

## Notes / gotchas

- Base image is `node:22-bookworm-slim` (glibc), not Alpine — matches the
  prebuilt native binaries used by `better-sqlite3` and
  `@anthropic-ai/claude-agent-sdk` (which bundles the `claude` CLI itself as
  a platform-specific optional dependency — nothing to install separately).
  The build now fails fast if that optional binary is missing for the
  target platform — see "Troubleshooting" above.
- No `USER` directive — the container runs as `root` (`$HOME=/root`). This
  is what makes the `docker-compose.creds.yml` credential mount work
  unmodified (see "Using your local Claude Code login" above).
- `git` is installed in the runtime image (needed by `GitService` at
  runtime) — see "Testing Git Sync" above for initializing a repo in the
  fixture project.
- `registry` mode rewrites `package.json`'s two `file:` deps to npm semver
  ranges (`--build-arg AGENT_ADAPTERS_VERSION=...` /
  `AGENT_CHAT_VERSION=...` to override) and deliberately drops
  `package-lock.json` before installing — the lockfile still records those
  two packages as local symlinks, which `npm ci`/`npm install` would
  otherwise keep honoring (as dangling symlinks) even after `package.json`
  changes.
- `local` mode copies `../agent-adapters` and `../agent-chat` wholesale
  (including their own already-installed `node_modules`) into both the
  build and runtime stages, via Docker's named build contexts — no need to
  build with the parent directory as context.
