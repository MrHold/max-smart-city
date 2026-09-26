#!/usr/bin/env bash
# Резервная копия базы и фото. Каждую ночь запускается cron'ом на сервере (README → «Резервные копии»).
# Вручную: scripts/backup-db.sh
set -euo pipefail

cd "$(dirname "$0")/.."                     # корень проекта: здесь compose.yaml
BACKUP_DIR="${BACKUP_DIR:-/var/backups/msc}"
KEEP_DAYS="${KEEP_DAYS:-14}"
STAMP="$(date +%Y%m%d-%H%M)"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"                     # в копии — данные жителей: читать может только root

# База. -Fc — сжатый формат pg_dump, восстанавливается scripts/restore-db.sh.
# Пишем во временный файл и переименовываем только после успеха: оборванная копия не выдаст себя за целую.
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
  > "$BACKUP_DIR/db-$STAMP.dump.part"
mv "$BACKUP_DIR/db-$STAMP.dump.part" "$BACKUP_DIR/db-$STAMP.dump"

# Фото жителей и исполнителей из тома photos (через образ api, в нём том подключён в /data/photos)
docker compose run --rm --no-deps -T --entrypoint tar api -czf - -C /data photos \
  > "$BACKUP_DIR/photos-$STAMP.tar.gz.part"
mv "$BACKUP_DIR/photos-$STAMP.tar.gz.part" "$BACKUP_DIR/photos-$STAMP.tar.gz"

# Старше KEEP_DAYS дней — удаляем
find "$BACKUP_DIR" -name 'db-*.dump' -mtime +"$KEEP_DAYS" -delete
find "$BACKUP_DIR" -name 'photos-*.tar.gz' -mtime +"$KEEP_DAYS" -delete

echo "$(date -Is) копия готова: $(du -h "$BACKUP_DIR/db-$STAMP.dump" | cut -f1) база, $(du -h "$BACKUP_DIR/photos-$STAMP.tar.gz" | cut -f1) фото"