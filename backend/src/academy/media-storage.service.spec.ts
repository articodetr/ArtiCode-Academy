// Homepage images — the media directory (media-storage.service.ts) on a real
// temporary directory: the path guard, the temporary-file-then-rename write,
// reads that refuse anything but a stored regular file, best-effort deletes,
// the sweep of leftovers, and a directory that cannot be written.
import { mkdtemp, mkdir, readdir, readFile, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { MEDIA_FILE_PATTERN } from './homepage-images.settings.js';
import { MediaStorageService, MediaStorageUnavailableError, TEMPORARY_FILE_PATTERN, mediaPathOf, newMediaFileName, resolveMediaDirectory } from './media-storage.service.js';

const NAME = `${'3d'.repeat(16)}.png`;

function storageAt(directory: string): MediaStorageService {
  return new MediaStorageService({ get: () => directory } as never);
}

describe('MediaStorageService', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'articode-media-spec-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('resolves MEDIA_STORAGE_DIR: absolute as given, relative to the working directory', () => {
    expect(resolveMediaDirectory(root)).toBe(resolve(root));
    expect(resolveMediaDirectory('storage/media', root)).toBe(resolve(root, 'storage/media'));
    expect(resolveMediaDirectory('../media', join(root, 'backend'))).toBe(resolve(root, 'media'));
  });

  it('maps only a stored name to a path, always inside the directory', () => {
    expect(mediaPathOf(root, NAME)).toBe(join(resolve(root), NAME));
    for (const bad of [
      '..',
      `../${NAME}`,
      `..\\${NAME}`,
      `sub/${NAME}`,
      resolve(root, NAME),
      'C:\\Windows\\win.ini',
      '/etc/passwd',
      `${NAME}/..`,
      '.tmp-0123',
      `${'3D'.repeat(16)}.png`,
      `${'3d'.repeat(16)}.svg`,
      '',
    ]) {
      expect(mediaPathOf(root, bad), bad).toBeNull();
    }
  });

  it('names a new file with 32 random lower-case hex characters and the extension', () => {
    const names = new Set(Array.from({ length: 50 }, () => newMediaFileName('webp')));
    expect(names.size).toBe(50);
    for (const name of names) expect(name).toMatch(MEDIA_FILE_PATTERN);
    expect(newMediaFileName('jpg')).toMatch(/^[0-9a-f]{32}\.jpg$/);
  });

  it('creates the directory, writes through a temporary name and leaves only the final file', async () => {
    const directory = join(root, 'nested', 'media');
    const storage = storageAt(directory);
    await storage.onModuleInit();
    const bytes = Buffer.from('picture bytes');
    const name = await storage.write(bytes, 'png');
    expect(name).toMatch(MEDIA_FILE_PATTERN);
    expect(await readdir(directory)).toEqual([name]);
    expect((await readFile(join(directory, name))).equals(bytes)).toBe(true);
    expect((await storage.read(name))!.equals(bytes)).toBe(true);
  });

  it('reads nothing for a malformed, unknown or non-regular name, and never follows a symbolic link', async () => {
    const storage = storageAt(root);
    expect(await storage.read(NAME)).toBeNull(); // not there
    expect(await storage.read('../outside.png')).toBeNull();
    await mkdir(join(root, NAME)); // a directory with a stored name
    expect(await storage.read(NAME)).toBeNull();
    const secret = join(root, 'secret.txt');
    await writeFile(secret, 'not a picture');
    const link = `${'4e'.repeat(16)}.png`;
    let linked = true;
    try {
      await symlink(secret, join(root, link));
    } catch {
      linked = false; // Windows without the symlink privilege: nothing to check
    }
    if (linked) expect(await storage.read(link)).toBeNull();
  });

  it('removes a file best effort: true when it is gone (missing included), false for a malformed name, never a throw', async () => {
    const storage = storageAt(root);
    const name = await storage.write(Buffer.from('x'), 'jpg');
    expect(await storage.remove(name)).toBe(true);
    expect(await readdir(root)).toEqual([]);
    expect(await storage.remove(name)).toBe(true);
    expect(await storage.remove('../x.png')).toBe(false);
    await mkdir(join(root, NAME)); // unlink of a directory fails: logged, not thrown
    expect(await storage.remove(NAME)).toBe(false);
  });

  it('opens a stored file as a stream with its size, and states its size without reading it', async () => {
    const storage = storageAt(root);
    const bytes = Buffer.alloc(200_000, 7);
    const name = await storage.write(bytes, 'webp');
    const opened = (await storage.open(name))!;
    expect(opened.size).toBe(bytes.length);
    const chunks: Buffer[] = [];
    for await (const chunk of opened.stream) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).equals(bytes)).toBe(true);
    expect(await storage.stat(name)).toEqual({ size: bytes.length });
    expect(await storage.open(NAME)).toBeNull();
    expect(await storage.stat(NAME)).toBeNull();
    expect(await storage.stat('../x.png')).toBeNull();
    await mkdir(join(root, `${'6a'.repeat(16)}.png`));
    expect(await storage.stat(`${'6a'.repeat(16)}.png`)).toBeNull();
    expect(await storage.open(`${'6a'.repeat(16)}.png`)).toBeNull();
  });

  it('sweeps old temporary files and old unreferenced files only — never a referenced, a recent or a foreign one', async () => {
    const storage = storageAt(root);
    const hour = 60 * 60 * 1000;
    const now = Date.now();
    const old = new Date(now - 2 * hour);
    const names = {
      oldTemporary: `.tmp-${'a1'.repeat(16)}`,
      newTemporary: `.tmp-${'b2'.repeat(16)}`,
      oldOrphan: `${'c3'.repeat(16)}.png`,
      newOrphan: `${'d4'.repeat(16)}.jpg`,
      oldReferenced: `${'e5'.repeat(16)}.webp`,
      oldForeign: 'notes.txt',
      oldTemporaryLookalike: '.tmp-not-ours',
    };
    for (const name of Object.values(names)) await writeFile(join(root, name), 'x');
    for (const name of [names.oldTemporary, names.oldOrphan, names.oldReferenced, names.oldForeign, names.oldTemporaryLookalike]) await utimes(join(root, name), old, old);
    await mkdir(join(root, `${'f6'.repeat(16)}.png`)); // a directory with a stored name
    expect(TEMPORARY_FILE_PATTERN.test(names.oldTemporary)).toBe(true);

    const result = await storage.sweep(new Set([names.oldReferenced]), hour, now);
    expect(result).toEqual({ temporary: 1, orphans: 1 });
    expect((await readdir(root)).sort()).toEqual(
      [names.newTemporary, names.newOrphan, names.oldReferenced, names.oldForeign, names.oldTemporaryLookalike, `${'f6'.repeat(16)}.png`].sort(),
    );
    // A missing directory sweeps nothing and does not throw.
    expect(await storageAt(join(root, 'missing')).sweep(new Set(), hour, now)).toEqual({ temporary: 0, orphans: 0 });
  });

  it('answers MediaStorageUnavailableError (an error code, never a path) when the directory cannot be created, and leaves no temporary file', async () => {
    const blocker = join(root, 'not-a-directory');
    await writeFile(blocker, 'x');
    const storage = storageAt(join(blocker, 'media'));
    await expect(storage.onModuleInit()).resolves.toBeUndefined(); // logged, the app keeps booting
    const failure = await storage.write(Buffer.from('x'), 'png').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(MediaStorageUnavailableError);
    expect((failure as Error).message).not.toContain(root);
    expect(await readdir(root)).toEqual(['not-a-directory']);
  });
});
