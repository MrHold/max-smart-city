export interface StoredFile {
  buffer: Buffer;
  mime: string;
}

/** Файлы за интерфейсом: сейчас диск (Docker volume), позже — S3 заменой одной реализации. */
export interface Storage {
  put(buffer: Buffer, mime: string): Promise<{ key: string }>;
  get(key: string): Promise<StoredFile | null>;
}

export const allowedImageTypes: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
};

export const maxPhotoBytes = 5 * 1024 * 1024;
