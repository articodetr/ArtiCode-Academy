import { ApiProperty } from '@nestjs/swagger';
import { IMAGE_CONTENT_TYPES, IMAGE_MAX_BYTES } from './homepage-images.media.js';
import type { ImageContentType } from './homepage-images.media.js';
import { HOMEPAGE_IMAGE_KEYS } from './homepage-images.settings.js';
import type { HomepageImageKey } from './homepage-images.settings.js';

const MEDIA_URL_EXAMPLE = '/api/academy/media/0f1e2d3c4b5a69788796a5b4c3d2e1f0.webp';

/** One place of the home page as the administration sees it (a default: `custom: false` and every other field null). */
export class HomepageImageDto {
  @ApiProperty({ enum: HOMEPAGE_IMAGE_KEYS, example: 'heroStudent' })
  key: HomepageImageKey;

  @ApiProperty({ type: Boolean, description: 'true = the academy’s own picture is published; false = the built-in default' })
  custom: boolean;

  @ApiProperty({ type: String, nullable: true, example: MEDIA_URL_EXAMPLE, description: 'Root-relative URL of the published picture (GET /api/academy/media/:file); null for the default' })
  url: string | null;

  @ApiProperty({ type: String, nullable: true, enum: IMAGE_CONTENT_TYPES, example: 'image/webp' })
  contentType: ImageContentType | null;

  @ApiProperty({ type: 'integer', nullable: true, example: 960, description: 'Width in pixels as a browser shows it' })
  width: number | null;

  @ApiProperty({ type: 'integer', nullable: true, example: 680, description: 'Height in pixels as a browser shows it' })
  height: number | null;

  @ApiProperty({ type: 'integer', nullable: true, example: 184320, description: 'Size of the stored file (metadata removed)' })
  bytes: number | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'When the picture was published (ISO 8601)' })
  updatedAt: string | null;
}

/** GET/PUT/DELETE /api/academy/homepage-images: the four places and the upload limits. */
export class HomepageImagesDto {
  @ApiProperty({ type: () => HomepageImageDto, isArray: true, description: 'Always the four keys, in the order heroStudent, aboutLearners, promoTraining, whyClassroom' })
  items: HomepageImageDto[];

  @ApiProperty({ type: 'integer', example: IMAGE_MAX_BYTES, description: 'Largest accepted upload in bytes (5 MiB)' })
  maxBytes: number;

  @ApiProperty({ type: String, isArray: true, enum: IMAGE_CONTENT_TYPES, example: [...IMAGE_CONTENT_TYPES], description: 'Accepted Content-Type values of the upload' })
  contentTypes: ImageContentType[];
}

/** `homepageImages` of API-205: the public URL of each place, null = the built-in default. */
export class PublicHomepageImagesDto {
  @ApiProperty({ type: String, nullable: true, example: MEDIA_URL_EXAMPLE })
  heroStudent: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  aboutLearners: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  promoTraining: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  whyClassroom: string | null;
}
