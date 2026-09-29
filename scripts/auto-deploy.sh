#!/usr/bin/env bash
# Автодеплой: если в origin/master появились новые коммиты — подтянуть и пересобрать.
# Запускается cron'ом раз в 2 минуты (/etc/cron.d/msc-deploy).
# Если изменилась только документация (*.md, docs/) — только подтягиваем файлы, без пересборки.
set -euo pipefail

cd /opt/max-smart-city

# Не запускаться, если предыдущий деплой ещё собирается
exec 9>/tmp/msc-deploy.lock
flock -n 9 || exit 0

git fetch -q origin master
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/master)
[ "$LOCAL" = "$REMOTE" ] && exit 0   # нового ничего — тихо выходим

# Какие файлы поменялись между тем, что на сервере, и тем, что в master
CHANGED=$(git diff --name-only "$LOCAL" "$REMOTE")
# grep -v оставляет строки, которые НЕ документация; -q — ничего не печатать, только код возврата
ONLY_DOCS=1
if echo "$CHANGED" | grep -qvE '(\.md$|^docs/)'; then ONLY_DOCS=0; fi

echo "$(date -Is) деплой ${LOCAL:0:7} -> ${REMOTE:0:7}"
# --ff-only: только «перемотка вперёд»; если на сервере кто-то что-то закоммитил руками,
# скрипт остановится с ошибкой, а не будет сам сливать ветки
git merge --ff-only -q origin/master

if [ "$ONLY_DOCS" = 1 ]; then
  echo "$(date -Is) изменилась только документация — без пересборки"
  exit 0
fi

docker compose up -d --build --remove-orphans
docker image prune -f > /dev/null   # убрать старые образы, иначе диск забьётся
echo "$(date -Is) готово"
