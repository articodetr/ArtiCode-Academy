import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../audit/audit.service.js';
import type { AuthPrincipal, RequestContext } from '../auth/principal.js';
import type { Env } from '../config/env.schema.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { academyError } from './academy.errors.js';
import { ACADEMY_ENTITY_TYPE } from './academy.service.js';
import type { HomepageImageDto, HomepageImagesDto } from './homepage-images.dto.js';
import { IMAGE_CONTENT_TYPES, IMAGE_LIMITS, IMAGE_MAX_BYTES, dimensionsAllowed, imageContentTypeOf, inspectImage } from './homepage-images.media.js';
import type { ImageContentType } from './homepage-images.media.js';
import {
  HOMEPAGE_IMAGE_KEYS,
  hasStoredHomepageImage,
  isFileReferenced,
  isHomepageImageKey,
  mediaUrl,
  readHomepageImages,
  referenceOfFile,
  writeHomepageImage,
} from './homepage-images.settings.js';
import type { HomepageImageKey, HomepageImageReference } from './homepage-images.settings.js';
import { MediaStorageService, MediaStorageUnavailableError } from './media-storage.service.js';
import type { OpenedMedia } from './media-storage.service.js';

export const HOMEPAGE_IMAGE_AUDIT_ACTIONS = {
  updated: 'academy.homepage_image.updated',
  reset: 'academy.homepage_image.reset',
} as const;

/** A published picture as GET /api/academy/media/:file names it — from the stored reference alone, no disk access. */
export interface MediaReference {
  file: string;
  contentType: ImageContentType;
  /** A strong ETag: the file name is random per upload, so its bytes never change. */
  etag: string;
}

/** Leftovers younger than this are never swept: a write in progress may still own them. */
export const MEDIA_SWEEP_MIN_AGE_MS = 60 * 60 * 1000;

interface AcademySettingsRow {
  id: string;
  settings: Prisma.JsonValue;
}

/**
 * Homepage images (Settings → «صور الصفحة الرئيسية»): the academy replaces
 * each of the four pictures of the public home page `/home`. The bytes go to
 * the media directory (MediaStorageService), the reference to
 * `academy.settings.homepageImages.<key>`.
 *
 * A write validates everything first, writes the new file (temporary name,
 * then renamed), and only then opens ONE transaction that locks the academy
 * row (`FOR NO KEY UPDATE`, like PATCH /api/academy — the two serialise),
 * reads the CURRENT reference, writes the new one and records exactly one
 * audit event. The replaced file is deleted after the commit (best effort);
 * when anything before the commit fails, the new file is deleted and the
 * published picture is unchanged. Two uploads of the same key at once both
 * commit in turn, and each deletes the file it replaced: one reference and one
 * file remain.
 */
@Injectable()
export class HomepageImagesService implements OnApplicationBootstrap {
  private readonly logger = new Logger(HomepageImagesService.name);
  private readonly apiPrefix: string;
  private readonly sweepAtBoot: boolean;
  /** Referenced files found missing — each is logged once per process, not on every request. */
  private readonly missingLogged = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: MediaStorageService,
    config: ConfigService<Env, true>,
  ) {
    this.apiPrefix = config.get('API_PREFIX', { infer: true });
    // Off under NODE_ENV=test: the e2e suites share one database and call sweepMedia() on their own directory.
    this.sweepAtBoot = config.get('NODE_ENV', { infer: true }) !== 'test';
  }

  /** Once at boot, in the background: the leftovers of interrupted writes go. Never fails or delays the boot. */
  onApplicationBootstrap(): void {
    if (!this.sweepAtBoot) return;
    void this.sweepMedia().catch(() => undefined);
  }

  /**
   * Deletes temporary files and files no current `settings.homepageImages`
   * reference names, both older than an hour (MEDIA_SWEEP_MIN_AGE_MS). Nothing
   * is deleted when the settings cannot be read. Logs the counts only.
   */
  async sweepMedia(now: number = Date.now()): Promise<{ temporary: number; orphans: number } | null> {
    let referenced: Set<string>;
    try {
      const row = await this.prisma.db.academy.findFirst({ select: { settings: true } });
      const references = readHomepageImages(row?.settings ?? null);
      referenced = new Set(HOMEPAGE_IMAGE_KEYS.map((key) => references[key]?.file).filter((file): file is string => typeof file === 'string'));
    } catch {
      this.logger.warn('the media directory was not swept: the academy settings could not be read');
      return null;
    }
    const result = await this.storage.sweep(referenced, MEDIA_SWEEP_MIN_AGE_MS, now);
    if (result.temporary + result.orphans > 0) {
      this.logger.log(`swept the media directory: ${result.temporary} temporary and ${result.orphans} unreferenced file(s) removed`);
    }
    return result;
  }

  /** GET /api/academy/homepage-images. */
  async list(): Promise<HomepageImagesDto> {
    return this.toDto((await this.load()).settings);
  }

  /** PUT /api/academy/homepage-images/:key — the body is the image bytes. */
  async replace(key: string, contentTypeHeader: string | undefined, body: unknown, caller: AuthPrincipal, ctx: RequestContext): Promise<HomepageImagesDto> {
    const imageKey = this.assertKey(key);
    const declared = imageContentTypeOf(contentTypeHeader);
    if (declared === null) throw academyError.imageTypeUnsupported(IMAGE_CONTENT_TYPES);
    // The raw parser of this route leaves a Buffer; no body at all leaves undefined.
    if (!Buffer.isBuffer(body) || body.length === 0) throw academyError.imageInvalid('empty');
    if (body.length > IMAGE_MAX_BYTES) throw academyError.imageTooLarge(IMAGE_MAX_BYTES);
    const inspection = inspectImage(body, declared);
    if (!inspection.ok) throw academyError.imageInvalid(inspection.reason);
    const image = inspection.image;
    if (!dimensionsAllowed(image.width, image.height)) throw academyError.imageDimensionsInvalid(image.width, image.height, IMAGE_LIMITS);

    const academy = await this.load(); // 503 academy_not_configured before any file is written
    let file: string;
    try {
      file = await this.storage.write(image.bytes, image.extension);
    } catch (error) {
      if (error instanceof MediaStorageUnavailableError) throw academyError.mediaStorageUnavailable();
      throw error;
    }
    const reference: HomepageImageReference = {
      file,
      contentType: image.contentType,
      width: image.width,
      height: image.height,
      bytes: image.bytes.length,
      updatedAt: new Date().toISOString(),
    };

    let outcome: { settings: Prisma.JsonValue; replaced: string | null };
    try {
      outcome = await this.prisma.db.$transaction(async (tx) => {
        const fresh = await this.lockedSettings(tx, academy.id);
        const current = readHomepageImages(fresh)[imageKey];
        const next = writeHomepageImage(fresh, imageKey, reference);
        await tx.academy.update({ where: { id: academy.id }, data: { settings: next as Prisma.InputJsonValue }, select: { id: true } });
        // The key and the picture's size — never the bytes, a path or the file name.
        await this.audit.record(
          {
            action: HOMEPAGE_IMAGE_AUDIT_ACTIONS.updated,
            actorUserId: caller.id,
            entityType: ACADEMY_ENTITY_TYPE,
            entityId: academy.id,
            metadata: { key: imageKey, contentType: reference.contentType, width: reference.width, height: reference.height, bytes: reference.bytes, replaced: current !== null },
            ...ctx,
          },
          tx,
        );
        return { settings: next as Prisma.JsonValue, replaced: current?.file ?? null };
      });
    } catch (error) {
      // Nothing was committed: the new file goes, the published picture stays.
      await this.storage.remove(file);
      throw error;
    }
    await this.removeUnreferenced(outcome.replaced, outcome.settings);
    return this.toDto(outcome.settings);
  }

  /** DELETE /api/academy/homepage-images/:key — back to the built-in default; a key without a picture is a no-op. */
  async reset(key: string, caller: AuthPrincipal, ctx: RequestContext): Promise<HomepageImagesDto> {
    const imageKey = this.assertKey(key);
    const academy = await this.load();
    // Fast path: nothing stored under the key — no transaction, no lock, no event.
    if (!hasStoredHomepageImage(academy.settings, imageKey)) return this.toDto(academy.settings);

    const outcome = await this.prisma.db.$transaction(async (tx) => {
      const fresh = await this.lockedSettings(tx, academy.id);
      if (!hasStoredHomepageImage(fresh, imageKey)) return { settings: fresh, removed: null as string | null };
      const current = readHomepageImages(fresh)[imageKey];
      const next = writeHomepageImage(fresh, imageKey, null);
      await tx.academy.update({ where: { id: academy.id }, data: { settings: next as Prisma.InputJsonValue }, select: { id: true } });
      await this.audit.record(
        {
          action: HOMEPAGE_IMAGE_AUDIT_ACTIONS.reset,
          actorUserId: caller.id,
          entityType: ACADEMY_ENTITY_TYPE,
          entityId: academy.id,
          metadata: { key: imageKey },
          ...ctx,
        },
        tx,
      );
      return { settings: next as Prisma.JsonValue, removed: current?.file ?? null };
    });
    await this.removeUnreferenced(outcome.removed, outcome.settings);
    return this.toDto(outcome.settings);
  }

  /**
   * GET /api/academy/media/:file, first step — only a name the CURRENT
   * settings reference is served (a replaced or reset picture stops at once);
   * anything else is 404 media_not_found. The answer comes from the stored
   * reference alone, so a revalidation (304) never touches the disk.
   */
  async mediaReference(file: string): Promise<MediaReference> {
    const row = await this.prisma.db.academy.findFirst({ select: { settings: true } });
    const reference = row ? referenceOfFile(row.settings, file) : null;
    if (reference === null) throw academyError.mediaNotFound();
    return { file: reference.file, contentType: reference.contentType, etag: `"${reference.file.split('.', 1)[0]}"` };
  }

  /** The bytes of a referenced picture as a stream (GET), or 404 media_not_found when the file is missing. */
  async openMedia(reference: MediaReference): Promise<OpenedMedia> {
    const opened = await this.storage.open(reference.file);
    if (opened === null) throw this.missingMedia(reference.file);
    return opened;
  }

  /** The size of a referenced picture without reading it (HEAD), or 404 media_not_found when the file is missing. */
  async statMedia(reference: MediaReference): Promise<{ size: number }> {
    const stat = await this.storage.stat(reference.file);
    if (stat === null) throw this.missingMedia(reference.file);
    return stat;
  }

  private missingMedia(file: string): Error {
    if (!this.missingLogged.has(file)) {
      this.missingLogged.add(file);
      this.logger.warn(`the homepage image ${file} is referenced but missing from the media directory`);
    }
    return academyError.mediaNotFound();
  }

  private assertKey(key: string): HomepageImageKey {
    if (!isHomepageImageKey(key)) throw academyError.homepageImageUnknown(String(key).slice(0, 64), HOMEPAGE_IMAGE_KEYS);
    return key;
  }

  /** The single row's id and settings, or 503 academy_not_configured. */
  private async load(): Promise<AcademySettingsRow> {
    const row = await this.prisma.db.academy.findFirst({ select: { id: true, settings: true } });
    if (!row) throw academyError.notConfigured();
    return row;
  }

  /** Locks the academy row (FOR NO KEY UPDATE, as PATCH /api/academy does) and reads its settings afresh. */
  private async lockedSettings(tx: Prisma.TransactionClient, id: string): Promise<Prisma.JsonValue> {
    await tx.$queryRaw`SELECT id FROM academy WHERE id = ${id}::uuid FOR NO KEY UPDATE`;
    const fresh = await tx.academy.findUnique({ where: { id }, select: { settings: true } });
    if (!fresh) throw academyError.notConfigured();
    return fresh.settings;
  }

  /** After the commit: deletes a file no key references any more (best effort, logged by the storage). */
  private async removeUnreferenced(file: string | null, settings: Prisma.JsonValue): Promise<void> {
    if (file !== null && !isFileReferenced(settings, file)) await this.storage.remove(file);
  }

  private toDto(settings: unknown): HomepageImagesDto {
    const references = readHomepageImages(settings);
    return {
      items: HOMEPAGE_IMAGE_KEYS.map((key): HomepageImageDto => {
        const reference = references[key];
        if (!reference) return { key, custom: false, url: null, contentType: null, width: null, height: null, bytes: null, updatedAt: null };
        return {
          key,
          custom: true,
          url: mediaUrl(this.apiPrefix, reference.file),
          contentType: reference.contentType,
          width: reference.width,
          height: reference.height,
          bytes: reference.bytes,
          updatedAt: reference.updatedAt,
        };
      }),
      maxBytes: IMAGE_MAX_BYTES,
      contentTypes: [...IMAGE_CONTENT_TYPES],
    };
  }
}
