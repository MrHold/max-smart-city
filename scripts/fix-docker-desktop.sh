#!/usr/bin/env bash
# Docker Desktop на Windows падает при старте с сообщением вида
#   «rename …/sailor-ingest.sock …stale: The file cannot be accessed by the system»
# Это файлы сокетов, оставшиеся от прошлого аварийного завершения: Windows их
# не отдаёт, а из WSL они удаляются. Контейнеры, образы и тома не затрагиваются —
# они лежат внутри виртуальной машины.
#
# Закрыть Docker Desktop (кнопка Quit), затем запустить этот скрипт из WSL:
#   bash scripts/fix-docker-desktop.sh
# Кнопку «Reset to factory defaults» в окне ошибки жать не нужно: она сносит
# все контейнеры и образы.
set -u

user=${WINDOWS_USER:-$(basename "$(dirname "$(ls -d /mnt/c/Users/*/AppData 2>/dev/null | head -1)")")}
base="/mnt/c/Users/$user/AppData"

roots=(
  "$base/Local/Docker/run"
  "$base/Local/docker-secrets-engine"
  "$base/Roaming/Docker/run"
)

removed=0
for dir in "${roots[@]}"; do
  [ -d "$dir" ] || continue
  for f in "$dir"/*; do
    [ -e "$f" ] || continue
    rm -rf "$f" 2>/dev/null && removed=$((removed + 1))
  done
done

echo "Удалено файлов сокетов: $removed"
echo 'Теперь можно запускать Docker Desktop.'
