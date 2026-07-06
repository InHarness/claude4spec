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
  if a credential was already saved through the app's own Settings UI.
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

## Verifying a code change

1. Rebuild: `docker/build.sh registry` (or `local`).
2. Run it (see above) and confirm the editor loads at `/welcome` or the
   project URL printed in `docker logs`.
3. For `local` mode specifically: after changing `../agent-adapters` or
   `../agent-chat`, remember those packages ship pre-built — rebuild that
   sibling package itself (its own `npm run build`) before rebuilding this
   image, otherwise the container still runs the old `dist/`.

## Cleanup

```bash
docker rm -f <container>
docker rmi claude4spec-test:registry claude4spec-test:local
rm -rf docker/environments/default/runtime      # or: docker/setup-env.sh --reset
```

## Notes / gotchas

- Base image is `node:22-bookworm-slim` (glibc), not Alpine — matches the
  prebuilt native binaries used by `better-sqlite3` and
  `@anthropic-ai/claude-agent-sdk` (which bundles the `claude` CLI itself as
  a platform-specific optional dependency — nothing to install separately).
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
