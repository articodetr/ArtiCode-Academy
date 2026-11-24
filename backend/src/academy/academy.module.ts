import { Module } from '@nestjs/common';
import { AcademyController } from './academy.controller.js';
import { AcademyService } from './academy.service.js';
import { HomepageImagesController } from './homepage-images.controller.js';
import { HomepageImagesService } from './homepage-images.service.js';
import { MediaStorageService } from './media-storage.service.js';

/**
 * MOD-02/MOD-14 minimum — the single `academy` row: `GET /api/academy` and
 * `PATCH /api/academy`. Relies on the global guards (AuthModule), PrismaModule
 * and the global AuditModule; reuses the D1 localized-text DTO of roles/ and
 * the PATCH normalisers of users/. The homepage images (the four pictures of
 * the public home page) live here too: their references in
 * `settings.homepageImages`, their files in the media directory
 * (MediaStorageService, MEDIA_STORAGE_DIR).
 */
@Module({
  controllers: [AcademyController, HomepageImagesController],
  providers: [AcademyService, HomepageImagesService, MediaStorageService],
  exports: [AcademyService],
})
export class AcademyModule {}
