# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS builder
WORKDIR /app

ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build && npm run build:ops && find /app/dist/client /app/dist/server -name '*.map' -delete

FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/drizzle ./drizzle

RUN mkdir -p /app/logs /app/assets /app/sourcemaps && chown -R node:node /app/logs /app/assets /app/sourcemaps

USER node
EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3 CMD node dist/ops/health-check.mjs

CMD ["node", "dist/ops/serve.mjs"]
