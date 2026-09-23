FROM node:22-alpine AS build
RUN corepack enable pnpm
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/miniapp/package.json apps/miniapp/
COPY packages/domain/package.json packages/domain/
RUN pnpm install --frozen-lockfile --filter @msc/miniapp...
COPY packages/domain packages/domain
COPY apps/miniapp apps/miniapp
ARG VITE_API_URL=
ARG VITE_BOT_NAME=
ARG VITE_DEMO_MODE=1
RUN pnpm --filter @msc/miniapp build

FROM caddy:2-alpine
COPY apps/miniapp/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/miniapp/dist /srv
