# The api's image (ADR 0005). Render and docker-compose.yml run this same image. Build it from the repo root, so
# contracts/ is in the context:
#   docker build -f apps/api/Dockerfile .
# Node matches .nvmrc (24), pinned to a minor version. Debian 13 (trixie), not the default bookworm: the SurrealDB
# native module (@surrealdb/node-native) needs a newer libstdc++ than bookworm's.
FROM node:24.22-trixie-slim

# No npm update notice in the logs.
ENV NPM_CONFIG_UPDATE_NOTIFIER=false
WORKDIR /app

# Manifests first, so the install layer is cached until a dependency changes. npm ci checks every workspace in the
# lockfile, so each one's package.json is here; only the api's dependencies (and contracts/, which it uses) are
# installed, without dev dependencies.
COPY package.json package-lock.json ./
COPY contracts/package.json contracts/
COPY apps/engine/package.json apps/engine/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @builder/api --include-workspace-root --omit=dev && npm cache clean --force

COPY contracts/src contracts/src
COPY apps/api/src apps/api/src
COPY apps/api/db apps/api/db

# The code stays owned by root, read-only to the app. data/ is for SurrealDB in this process when SURREAL_URL is
# unset, which NODE_ENV=production refuses; on Render the api uses SurrealDB Cloud and writes nothing.
RUN mkdir apps/api/data && chown node:node apps/api/data
USER node
WORKDIR /app/apps/api
EXPOSE 3001
# The `start` script, run by node itself rather than through npm: npm doesn't let the app finish its SIGTERM
# shutdown (closing the database) before the container stops. Render's pre-deploy command runs `npm run migrate`
# in this image first (render.yaml).
CMD ["node", "src/server.ts"]
