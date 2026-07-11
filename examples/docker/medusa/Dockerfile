# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Stage 1: build the SumUp plugin straight from this repo's source.
# No `npm publish` and no local registry needed - we compile `.medusa/server`
# and later hand-place it into the Medusa app's node_modules.
# ---------------------------------------------------------------------------
FROM node:26-bookworm AS plugin
WORKDIR /plugin

COPY package.json yarn.lock tsconfig.json ./
RUN npm install --global yarn@1.22.22
# Cache mount: tarballs are downloaded once and reused across stages/builds.
RUN --mount=type=cache,id=sumup-medusa-yarn-v1,target=/usr/local/share/.cache/yarn,sharing=locked yarn install --frozen-lockfile

COPY src ./src
RUN yarn build

# ---------------------------------------------------------------------------
# Stage 2: install backend dependencies (isolated so the layer is cacheable).
# ---------------------------------------------------------------------------
FROM node:26-bookworm AS deps
WORKDIR /app

COPY examples/docker/medusa/package.json examples/docker/medusa/yarn.lock ./
RUN npm install --global yarn@1.22.22
# yarn install uses the lockfile for a clean, reproducible install, with cache
# hits served from the shared Yarn cache mount.
RUN --mount=type=cache,id=sumup-medusa-yarn-v1,target=/usr/local/share/.cache/yarn,sharing=locked yarn install --frozen-lockfile

# ---------------------------------------------------------------------------
# Stage 3: the Medusa backend that loads the locally-built plugin.
# ---------------------------------------------------------------------------
FROM node:26-bookworm
ENV NODE_ENV=development
WORKDIR /app

RUN npm install --global yarn@1.22.22

# Copy the pre-installed node_modules from the deps stage instead of running
# yarn install in the final image again. `@medusajs/*` and `@sumup/sdk` live
# here so the
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
