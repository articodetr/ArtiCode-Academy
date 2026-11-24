// Homepage images (MOD-02/MOD-14): the directory on the API server's disk
// that holds the uploaded pictures — MEDIA_STORAGE_DIR, relative to the
// process's working directory unless absolute (default `storage/media`, i.e.
// backend/storage/media in development; /var/lib/articode/media on the `media`
// volume of the deployment).
//
// Path safety: every name is checked against MEDIA_FILE_PATTERN (32 hex + a
// known extension) BEFORE any file-system call, then resolved inside the
// directory and compared with it, so no `..`, separator, drive letter or other
// name can reach another file. Reads refuse anything that is not a regular
// file (a symbolic link planted in the directory is not followed: lstat, then
// O_NOFOLLOW where the platform has it, then fstat of the opened descriptor).
// Errors and log lines name the file only, never the directory.
//
// Durability: a new file is written to `.tmp-<random>`, fsynced, renamed into
// place and the directory fsynced (where the platform allows it), so a crash
// never leaves a referenced name pointing at a half-written file. sweep()
// removes what a crash can leave behind: old temporary files and old files no
// reference names.
import { Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { constants, promises as fs } from 'node:fs';
import type { ReadStream } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import type { Env } from '../config/env.schema.js';
import type { ImageExtension } from './homepage-images.media.js';
import { isMediaFileName } from './homepage-images.settings.js';

/** The directory could not be created or written (→ 503 media_storage_unavailable). */
export class MediaStorageUnavailableError extends Error {
  constructor(readonly code: string) {
    super(`media storage unavailable (${code})`);
    this.name = 'MediaStorageUnavailableError';
  }
}

/** The error code of a file-system failure (`EACCES`, `ENOSPC`, …) — never its message, which names the path. */
export function fsErrorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : 'UNKNOWN';
}

/** MEDIA_STORAGE_DIR → an absolute directory (relative = to the working directory). */
export function resolveMediaDirectory(configured: string, cwd: string = process.cwd()): string {
  return isAbsolute(configured) ? resolve(configured) : resolve(cwd, configured);
}

/** The absolute path of a stored file name inside `directory`, or null for any other name. */
export function mediaPathOf(directory: string, name: string): string | null {
  if (!isMediaFileName(name)) return null;
  const path = resolve(join(directory, name));
  return path === join(resolve(directory), name) ? path : null;
}

/** `<32 random lower-case hex>.<extension>` — never the uploader's file name. */
export function newMediaFileName(extension: ImageExtension): string {
  return `${randomBytes(16).toString('hex')}.${extension}`;
}

/** The name of a temporary upload: `.tmp-` and 32 random lower-case hex characters. */
export const TEMPORARY_FILE_PATTERN = /^\.tmp-[0-9a-f]{32}$/;

/** An opened stored file: its size and a stream of its bytes (the descriptor closes with the stream). */
export interface OpenedMedia {
  size: number;
  stream: ReadStream;
}

/** What sweep() deleted. */
export interface MediaSweepResult {
  temporary: number;
  orphans: number;
}

const DIRECTORY_MODE = 0o755;
const FILE_MODE = 0o644;
/** `O_NOFOLLOW` where the platform has it (not on Windows, where the lstat and fstat checks stand alone). */
const READ_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);
/** What a directory fsync may answer where the platform cannot do it (Windows): not an error of the write. */
const DIRECTORY_SYNC_UNSUPPORTED = new Set(['EPERM', 'EISDIR', 'EINVAL', 'EBADF', 'EACCES', 'ENOTSUP']);

@Injectable()
export class MediaStorageService implements OnModuleInit {
  private readonly logger = new Logger(MediaStorageService.name);
  readonly directory: string;

  constructor(config: ConfigService<Env, true>) {
    this.directory = resolveMediaDirectory(config.get('MEDIA_STORAGE_DIR', { infer: true }));
  }

  /** Creates the directory at boot when it can; a failure is logged and never stops the app (writes answer 503). */
  async onModuleInit(): Promise<void> {
    try {
      await this.ensureDirectory();
    } catch (error) {
      this.logger.warn(`the media directory is not available (${fsErrorCode(error)}); homepage image uploads will answer 503 until it is`);
    }
  }

  /**
   * Writes the bytes under a new random name: first to `.tmp-<random>` inside
   * the directory (fsynced), then renamed into place (atomic on one file
   * system) and the directory fsynced. Any failure removes the temporary file
   * and throws MediaStorageUnavailableError.
   */
  async write(bytes: Buffer, extension: ImageExtension): Promise<string> {
    const name = newMediaFileName(extension);
    const finalPath = mediaPathOf(this.directory, name);
    if (finalPath === null) throw new MediaStorageUnavailableError('EINVAL');
    const temporary = join(this.directory, `.tmp-${randomBytes(16).toString('hex')}`);
    try {
      await this.ensureDirectory();
      const handle = await fs.open(temporary, 'wx', FILE_MODE);
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.rename(temporary, finalPath);
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => undefined);
      throw new MediaStorageUnavailableError(fsErrorCode(error));
    }
    await this.syncDirectory();
    return name;
  }

  /**
   * Opens a stored file for streaming, or null when the name is not a stored
   * name, the file is missing or is not a regular file. The caller owns the
   * stream (its descriptor closes when it ends, errors or is destroyed).
   */
  async open(name: string): Promise<OpenedMedia | null> {
    const path = mediaPathOf(this.directory, name);
    if (path === null) return null;
    let handle: fs.FileHandle | null = null;
    try {
      if (!(await fs.lstat(path)).isFile()) return null;
      handle = await fs.open(path, READ_FLAGS);
      const stat = await handle.stat();
      if (!stat.isFile()) {
        await handle.close();
        return null;
      }
      const opened = handle;
      handle = null;
      return { size: stat.size, stream: opened.createReadStream({ autoClose: true }) };
    } catch (error) {
      if (handle) await handle.close().catch(() => undefined);
      if (fsErrorCode(error) !== 'ENOENT') this.logger.warn(`could not open the homepage image ${name} (${fsErrorCode(error)})`);
      return null;
    }
  }

  /** The size of a stored regular file without reading it (HEAD), or null like open(). */
  async stat(name: string): Promise<{ size: number } | null> {
    const path = mediaPathOf(this.directory, name);
    if (path === null) return null;
    try {
      const stat = await fs.lstat(path);
      return stat.isFile() ? { size: stat.size } : null;
    } catch (error) {
      if (fsErrorCode(error) !== 'ENOENT') this.logger.warn(`could not read the homepage image ${name} (${fsErrorCode(error)})`);
      return null;
    }
  }

  /** The whole stored file (small files and tests), or null like open(). */
  async read(name: string): Promise<Buffer | null> {
    const opened = await this.open(name);
    if (opened === null) return null;
    const chunks: Buffer[] = [];
    for await (const chunk of opened.stream) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
  }

  /**
   * Best effort: deletes a stored file and never throws (a missing file is
   * fine; any other failure is logged with the file name only). Returns
   * whether the file is gone.
   */
  async remove(name: string): Promise<boolean> {
    const path = mediaPathOf(this.directory, name);
    if (path === null) return false;
    try {
      await fs.unlink(path);
      return true;
    } catch (error) {
      if (fsErrorCode(error) === 'ENOENT') return true;
      this.logger.warn(`could not delete the homepage image ${name} (${fsErrorCode(error)})`);
      return false;
    }
  }

  /**
   * Deletes the leftovers of an interrupted write: temporary files, and stored
   * files no name in `referenced` names — both only when last modified more
   * than `olderThanMs` before `now`, so a write in progress (its temporary file,
   * or its final file before its reference commits) is never touched. Only
   * regular files with one of the two name patterns are considered; anything
   * else in the directory is left alone. Never throws: a missing directory or a
   * failed delete counts nothing.
   */
  async sweep(referenced: ReadonlySet<string>, olderThanMs: number, now: number = Date.now()): Promise<MediaSweepResult> {
    const result: MediaSweepResult = { temporary: 0, orphans: 0 };
    let entries: Array<{ name: string; isFile(): boolean }>;
    try {
      entries = await fs.readdir(this.directory, { withFileTypes: true });
    } catch {
      return result;
    }
    for (const entry of entries) {
      if (!entry.isFile()) continue; // directories and symbolic links are never touched
      const temporary = TEMPORARY_FILE_PATTERN.test(entry.name);
      const orphan = !temporary && isMediaFileName(entry.name) && !referenced.has(entry.name);
      if (!temporary && !orphan) continue;
      const path = join(this.directory, entry.name);
      try {
        const stat = await fs.lstat(path);
        if (!stat.isFile() || now - stat.mtimeMs <= olderThanMs) continue;
        await fs.unlink(path);
        if (temporary) result.temporary += 1;
        else result.orphans += 1;
      } catch {
        // gone meanwhile, or not deletable: left for the next sweep
      }
    }
    return result;
  }

  private async ensureDirectory(): Promise<void> {
    await fs.mkdir(this.directory, { recursive: true, mode: DIRECTORY_MODE });
    await fs.access(this.directory, constants.W_OK);
  }

  /** fsync of the directory after a rename, where the platform allows it; never fails the write. */
  private async syncDirectory(): Promise<void> {
    let handle: fs.FileHandle | null = null;
    try {
      handle = await fs.open(this.directory, 'r');
      await handle.sync();
    } catch (error) {
      if (!DIRECTORY_SYNC_UNSUPPORTED.has(fsErrorCode(error))) this.logger.warn(`could not sync the media directory (${fsErrorCode(error)})`);
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }
}
