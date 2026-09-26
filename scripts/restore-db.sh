#!/usr/bin/env bash
# Восстановление базы из копии:
#   scripts/restore-db.sh /var/backups/msc/db-ГГГГММДД-ЧЧММ.dump
# ВНИМАНИЕ: текущие данные базы заменяются данными из копии.
set -euo pipefail

cd "$(dirname "$0")/.."
FILE="${1:?Укажите файл копии: scripts/restore-db.sh /var/backups/msc/db-….dump}"
[ -f "$FILE" ] || { echo "Нет файла $FILE"; exit 1; }

read -rp "Заменить текущую базу данными из $FILE? Напишите yes: " answer
[ "$answer" = "yes" ] || { echo "Отменено, база не тронута"; exit 1; }

# На время восстановления API и бот не должны писать в базу
docker compose stop api bot
docker compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner' \
  < "$FILE"
docker compose start api bot
echo "Готово: база восстановлена из $FILE"