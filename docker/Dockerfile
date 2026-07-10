# syntax=docker/dockerfile:1.7

# Test-environment image for claude4spec.
#
# DEPS_MODE=registry (default) — installs @inharness-ai/agent-adapters and
#   @inharness-ai/agent-chat from npm, matching a real release.
# DEPS_MODE=local — installs those two packages from the sibling checkouts
#   next to this repo (../agent-adapters, ../agent-chat), so proposed
#   uncommitted changes to the agent runtime can be tested end-to-end. Build
#   with `docker/build.sh local`, which wires up the required named build
#   contexts (`--build-context agent-adapters=... agent-chat=...`).

ARG NODE_VERSION=22
ARG DEPS_MODE=registry
ARG AGENT_ADAPTERS_VERSION=^0.8.5
ARG AGENT_CHAT_VERSION=^0.3.1

FROM node:${NODE_VERSION}-bookworm-slim AS base
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# ---- deps: published npm versions ----
FROM base AS deps-registry
ARG AGENT_ADAPTERS_VERSION
ARG AGENT_CHAT_VERSION
COPY package.json ./
# package-lock.json pins these two as local symlinks ("link": true,
# resolved: "../agent-adapters") — npm keeps honoring that stale link entry
# (installing it as a dangling symlink) even after package.json is rewritten
# to a registry semver range, unless the lockfile is dropped first so npm
# resolves the whole tree fresh from the (rewritten) package.json.
RUN sed -i \
    -e "s#file:../agent-adapters#${AGENT_ADAPTERS_VERSION}#" \
    -e "s#file:../agent-chat#${AGENT_CHAT_VERSION}#" \
    package.json \
    && npm install

# ---- deps: local sibling checkouts (proposed/uncommitted agent runtime code) ----
FROM base AS deps-local
COPY --from=agent-adapters . /agent-adapters
COPY --from=agent-chat . /agent-chat
COPY package.json package-lock.json ./
RUN npm ci

FROM deps-${DEPS_MODE} AS deps

# Fail fast (at build time, not when a user opens agent chat) if the
# platform-specific optional native CLI binary didn't get installed — mirrors
# the resolution @anthropic-ai/claude-agent-sdk itself does at runtime
# (sdk.mjs), so a broken/stale install is caught here instead of surfacing
# later as "Native CLI binary ... not found" in the agent chat UI.
RUN node -e "\
const p = \`@anthropic-ai/claude-agent-sdk-\${process.platform}-\${process.arch}/claude\`; \
try { require.resolve(p); } \
catch { console.error('Missing native claude-agent-sdk binary: ' + p + ' — try rebuilding with --no-cache'); process.exit(1); }"

# ---- build ----
FROM deps AS build
COPY . .
RUN npm run build

# ---- runtime ----
FROM node:${NODE_VERSION}-bookworm-slim AS runtime-base
WORKDIR /app
# git — required at runtime by GitService (src/server/services/git.ts), the
# sole git shell-out in the server, for repo detection / commit-on-release /
# push-on-push.
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    C4S_HOME=/data \
    PROJECT_DIR=/workspace/project \
    PORT=3000

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY docker/init-git.sh /usr/local/bin/init-git.sh
RUN chmod +x /usr/local/bin/entrypoint.sh /usr/local/bin/init-git.sh

VOLUME ["/data", "/workspace"]
EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]

FROM runtime-base AS runtime-registry

# In local mode, node_modules/@inharness-ai/{agent-adapters,agent-chat} are
# relative symlinks to /agent-adapters and /agent-chat (npm's usual handling
# of `file:` deps) — those targets, including their OWN node_modules, must
# also exist in the final image or Node's module resolution (which follows
# symlinks to their real path) fails at runtime.
FROM runtime-base AS runtime-local
COPY --from=build /agent-adapters /agent-adapters
COPY --from=build /agent-chat /agent-chat

FROM runtime-${DEPS_MODE} AS runtime
