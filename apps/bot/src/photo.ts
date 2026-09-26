import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Тот же формат, что у apps/api/src/storage (index.ts + disk.ts): API отдаёт файл по этому ключу.
// Меняется формат там — менять и здесь.
const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
};
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

/** Кладёт фото туда же и под тем же именем, что и API: <2 символа>/<sha256[0..40]>.<расширение>. */
export async function savePhoto(
  root: string,
  buffer: Buffer,
  mime: string,
): Promise<{ key: string; sha256: string }> {
  const ext = EXT[mime];
  if (!ext) throw new Error(`unsupported ${mime}`);
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  const hash = sha256.slice(0, 40);
  const key = `${hash.slice(0, 2)}/${hash}.${ext}`;
  await mkdir(join(root, hash.slice(0, 2)), { recursive: true });
  await writeFile(join(root, key), buffer);
  return { key, sha256 };
}

/** Тип картинки по первым байтам файла: заголовку ответа MAX верим, только если байты не подошли. */
function detectMime(buffer: Buffer, fromHeader: string): string {
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.subarray(0, 4).toString('hex') === '89504e47') return 'image/png';
  if (
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  )
    return 'image/webp';
  return fromHeader;
}

/** Скачивает фото, которое пользователь прислал в чат (ссылка из вложения MAX). */
export async function downloadImage(url: string): Promise<{ buffer: Buffer; mime: string }> {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`MAX ответил ${res.status} при скачивании фото`);
  if (Number(res.headers.get('content-length') ?? 0) > MAX_PHOTO_BYTES) throw new Error('too_big');
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > MAX_PHOTO_BYTES) throw new Error('too_big');
  const header = (res.headers.get('content-type') ?? '').split(';')[0]?.trim() ?? '';
  return { buffer, mime: detectMime(buffer, header) };
}
