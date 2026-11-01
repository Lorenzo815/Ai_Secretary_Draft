# syntax=docker/dockerfile:1
# Build locally (Linux image, also from Windows/macOS):
#   docker buildx build --platform linux/amd64 -t ghcr.io/<owner>/oria-platform:<git-sha> .

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Placeholder only so modules that validate MONGODB_URI can load during the build.
# The real connection string is injected at runtime and never baked into the image.
RUN MONGODB_URI="mongodb://build-placeholder.invalid:27017" npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/src/scripts/run-app.mjs /app/src/scripts/assistant-worker.mjs ./src/scripts/
USER node
EXPOSE 3000
CMD ["node", "src/scripts/run-app.mjs", "standalone"]
