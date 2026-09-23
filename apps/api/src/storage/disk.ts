import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { allowedImageTypes, type Storage, type StoredFile } from './index';

const keyPattern = /^[a-f0-9]{2}\/[a-f0-9]{40}\.(jpg|png|webp|heic)$/;

export function diskStorage(root: string): Storage {
  return {
    async put(buffer, mime) {
      const ext = allowedImageTypes[mime];
      if (!ext) throw new Error(`unsupported mime ${mime}`);
      const hash = createHash('sha256').update(buffer).digest('hex').slice(0, 40);
      const key = `${hash.slice(0, 2)}/${hash}.${ext}`;
      await mkdir(join(root, hash.slice(0, 2)), { recursive: true });
      await writeFile(join(root, key), buffer);
      return { key };
    },
    async get(key): Promise<StoredFile | null> {
      if (!keyPattern.test(key)) return null;
      try {
        const buffer = await readFile(join(root, key));
        const ext = key.slice(key.lastIndexOf('.') + 1);
        const mime =
          Object.entries(allowedImageTypes).find(([, e]) => e === ext)?.[0] ??
          'application/octet-stream';
        return { buffer, mime };
      } catch {
        return null;
      }
    },
  };
}
