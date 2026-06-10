# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Stage 1: build the SumUp plugin straight from this repo's source.
# No `npm publish` and no local registry needed - we compile `.medusa/server`
# and later hand-place it into the Medusa app's node_modules.
# ---------------------------------------------------------------------------
FROM node:20-bookworm AS plugin
WORKDIR /plugin

COPY package.json tsconfig.json ./
# Cache mount: tarballs are downloaded once and reused across stages/builds.
RUN --mount=type=cache,target=/root/.npm npm install

COPY src ./src
RUN npm run build

# ---------------------------------------------------------------------------
# Stage 2: install backend dependencies (isolated so the layer is cacheable).
# ---------------------------------------------------------------------------
FROM node:20-bookworm AS deps
WORKDIR /app

COPY examples/docker/medusa/package.json examples/docker/medusa/package-lock.json ./
# npm ci uses the lockfile for a clean, reproducible install - no network hit
# on cache hits.
RUN --mount=type=cache,target=/root/.npm npm ci

# ---------------------------------------------------------------------------
# Stage 3: the Medusa backend that loads the locally-built plugin.
# ---------------------------------------------------------------------------
FROM node:20-bookworm
ENV NODE_ENV=development
WORKDIR /app

# Copy the pre-installed node_modules from the deps stage instead of running
# npm install again. `@medusajs/*` and `@sumup/sdk` live here so the
# hand-placed plugin resolves its (peer) dependencies from the app, exactly
# like `medusa plugin:add` would.
COPY --from=deps /app/node_modules ./node_modules

# Hand-place the locally-built plugin into node_modules (no npm publish, no
# registry). We copy only package.json + the compiled `.medusa` output, NOT the
# plugin's own node_modules, to avoid a duplicate @medusajs/framework instance.
COPY --from=plugin /plugin/package.json ./node_modules/@sumup/medusa-plugin/package.json
COPY --from=plugin /plugin/.medusa ./node_modules/@sumup/medusa-plugin/.medusa

# Copy the rest of the backend app (config, src, entrypoint, ...).
COPY examples/docker/medusa/ ./
RUN chmod +x ./entrypoint.sh

EXPOSE 9000
ENTRYPOINT ["./entrypoint.sh"]
