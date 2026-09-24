# Один образ для api, bot и migrate: код один, команды запуска разные (см. compose.yaml).
# Бэкенд запускается из TypeScript через tsx — шага сборки нет.

FROM node:22-alpine
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable pnpm

# Сертификаты Минцифры: без них бот не достучится до platform-api2.max.ru
RUN apk add --no-cache ca-certificates
COPY docker/certs/*.crt /usr/local/share/ca-certificates/
RUN update-ca-certificates
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt

WORKDIR /repo

# Сначала только описания пакетов: пока они не менялись, Docker берёт установку из кэша
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/bot/package.json apps/bot/
COPY packages/db/package.json packages/db/
COPY packages/domain/package.json packages/domain/
COPY packages/documents/package.json packages/documents/
RUN pnpm install --frozen-lockfile --prod --filter "@msc/api..." --filter "@msc/bot..."

# Потом код и данные
COPY packages packages
COPY apps/api apps/api
COPY apps/bot apps/bot
COPY regions regions
COPY rules rules

ENV NODE_ENV=production
ENV PHOTOS_DIR=/data/photos
RUN mkdir -p /data/photos && chown node:node /data/photos

# Не от root: если в приложении найдут дыру, у взломщика будут права обычного пользователя
USER node

WORKDIR /repo/apps/api
CMD ["node", "--import", "tsx", "src/index.ts"]