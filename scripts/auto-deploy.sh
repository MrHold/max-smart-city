#!/usr/bin/env bash
# Автодеплой: если в origin/master появились новые коммиты — подтянуть и пересобрать.
# Запускается cron'ом раз в 2 минуты (/etc/cron.d/msc-deploy).
set -euo pipefail

cd /opt/max-smart-city

# Не запускаться, если предыдущий деплой ещё собирается
exec 9>/tmp/msc-deploy.lock
flock -n 9 || exit 0

git fetch -q origin master
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/master)
[ "$LOCAL" = "$REMOTE" ] && exit 0   # нового ничего — тихо выходим

echo "$(date -Is) деплой ${LOCAL:0:7} -> ${REMOTE:0:7}"
# --ff-only: только «перемотка вперёд»; если на сервере кто-то что-то закоммитил руками,
# скрипт остановится с ошибкой, а не будет сам сливать ветки
git merge --ff-only -q origin/master
docker compose up -d --build --remove-orphans
docker image prune -f > /dev/null   # убрать старые образы, иначе диск забьётся
echo "$(date -Is) готово"