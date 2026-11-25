import { Controller, Delete, Get, Param, Put, Req, Res } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiNotModifiedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiPayloadTooLargeResponse,
  ApiProduces,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnsupportedMediaTypeResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { pipeline } from 'node:stream';
import { AuthErrorDto } from '../auth/auth.dto.js';
import { requestContext } from '../auth/cookies.js';
import { CurrentUser, Public, RequirePermissions } from '../auth/decorators.js';
import type { AuthPrincipal } from '../auth/principal.js';
import { MANAGE_ACADEMY_SETTINGS_PERMISSION } from './academy.policy.js';
import { HomepageImagesDto } from './homepage-images.dto.js';
import { IMAGE_CONTENT_TYPES } from './homepage-images.media.js';
import { HOMEPAGE_IMAGE_KEYS } from './homepage-images.settings.js';
import { HomepageImagesService } from './homepage-images.service.js';

const UNAUTHORIZED = { type: AuthErrorDto, description: 'unauthenticated | token_expired | token_invalid | session_invalid' } as const;
const FORBIDDEN = { type: AuthErrorDto, description: 'permission_denied — `academy.settings.manage`; origin_forbidden (a write from a foreign Origin)' } as const;
const KEY_PARAM = { name: 'key', enum: HOMEPAGE_IMAGE_KEYS, description: 'The place of the public home page' } as const;
const UNKNOWN_KEY = { description: 'homepage_image_unknown { key, keys } — the key is not one of the four places' } as const;
const NOT_CONFIGURED = { description: 'academy_not_configured — the database holds no academy row (seed not run)' } as const;

/** A new upload always gets a new file name, so a served picture never changes: cache it for a year. */
const MEDIA_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/**
 * Homepage images (Settings → «صور الصفحة الرئيسية»): the academy's own
 * pictures for the four places of the public home page `/home`. The
 * administration reads, replaces and resets them with `academy.settings.manage`
 * (the global guards Origin → Auth → Permissions run first); every visitor
 * reads the published files through `GET /api/academy/media/:file`, which is
 * public and not rate limited (a page view shows four pictures). The public
 * URLs themselves reach visitors through API-205 (`homepageImages`).
 */
@ApiTags('academy')
@Controller('academy')
export class HomepageImagesController {
  constructor(private readonly images: HomepageImagesService) {}

  @Get('homepage-images')
  @ApiBearerAuth()
  @RequirePermissions(MANAGE_ACADEMY_SETTINGS_PERMISSION)
  @ApiOperation({
    summary: 'Read the homepage images',
    description:
      'The four places of the public home page in a fixed order (heroStudent, aboutLearners, promoTraining, whyClassroom): for each, whether the academy’s own picture is published ' +
      '(`custom`), its URL, type, size in pixels and bytes and when it was published — all null for the built-in default — and the upload limits. Requires `academy.settings.manage`.',
  })
  @ApiOkResponse({ type: HomepageImagesDto })
  @ApiUnauthorizedResponse(UNAUTHORIZED)
  @ApiForbiddenResponse(FORBIDDEN)
  @ApiServiceUnavailableResponse(NOT_CONFIGURED)
  list(): Promise<HomepageImagesDto> {
    return this.images.list();
  }

  @Put('homepage-images/:key')
  @ApiBearerAuth()
  @RequirePermissions(MANAGE_ACADEMY_SETTINGS_PERMISSION)
  @ApiParam(KEY_PARAM)
  @ApiConsumes(...IMAGE_CONTENT_TYPES)
  @ApiBody({ description: 'The image file itself (not JSON, not multipart): a PNG, JPEG or WebP of at most 5 MiB', schema: { type: 'string', format: 'binary' } })
  @ApiOperation({
    summary: 'Publish a homepage image',
    description:
      'The request body IS the image (`Content-Type: image/png | image/jpeg | image/webp`, at most 5 MiB). Its type is decided from the bytes (magic number and a structural parse), never from ' +
      'the Content-Type alone, and must equal the declared one; each side must be 64..8000 px and the picture at most 40 million pixels. The stored copy loses its metadata without being ' +
      're-encoded (EXIF/XMP/IPTC/comments — a photo’s GPS position is never published; a JPEG/PNG keeps its EXIF orientation alone); transparency is kept. The file gets a new random ' +
      'name, the reference is written in one transaction with the audit event `academy.homepage_image.updated { key, contentType, width, height, bytes, replaced }`, and the picture it ' +
      'replaces is deleted afterwards. Requires `academy.settings.manage`.',
  })
  @ApiOkResponse({ type: HomepageImagesDto, description: 'The four places after the upload' })
  @ApiBadRequestResponse({
    description:
      'image_invalid { reason: empty | unrecognized | type_mismatch | corrupt }; image_dimensions_invalid { width, height, minSide: 64, maxSide: 8000, maxPixels: 40000000 }',
  })
  @ApiUnauthorizedResponse(UNAUTHORIZED)
  @ApiForbiddenResponse(FORBIDDEN)
  @ApiNotFoundResponse(UNKNOWN_KEY)
  @ApiPayloadTooLargeResponse({ description: 'image_too_large { maxBytes: 5242880 }' })
  @ApiUnsupportedMediaTypeResponse({ description: 'image_type_unsupported { contentTypes } — another Content-Type (SVG, JSON, none, …)' })
  @ApiServiceUnavailableResponse({ description: 'media_storage_unavailable — the media directory is not writable; academy_not_configured' })
  replace(@Param('key') key: string, @Req() req: Request, @CurrentUser() caller: AuthPrincipal): Promise<HomepageImagesDto> {
    const contentType = req.headers['content-type'];
    return this.images.replace(key, typeof contentType === 'string' ? contentType : undefined, req.body as unknown, caller, requestContext(req));
  }

  @Delete('homepage-images/:key')
  @ApiBearerAuth()
  @RequirePermissions(MANAGE_ACADEMY_SETTINGS_PERMISSION)
  @ApiParam(KEY_PARAM)
  @ApiOperation({
    summary: 'Restore the default homepage image',
    description:
      'Removes the academy’s own picture of this key only — the built-in default shows again — in one transaction with the audit event `academy.homepage_image.reset { key }`; the file is ' +
      'deleted afterwards and its URL answers 404 at once. A key without a picture of its own is 200 without a write or an event. Requires `academy.settings.manage`.',
  })
  @ApiOkResponse({ type: HomepageImagesDto, description: 'The four places after the reset' })
  @ApiUnauthorizedResponse(UNAUTHORIZED)
  @ApiForbiddenResponse(FORBIDDEN)
  @ApiNotFoundResponse(UNKNOWN_KEY)
  @ApiServiceUnavailableResponse(NOT_CONFIGURED)
  reset(@Param('key') key: string, @Req() req: Request, @CurrentUser() caller: AuthPrincipal): Promise<HomepageImagesDto> {
    return this.images.reset(key, caller, requestContext(req));
  }

  @Get('media/:file')
  @Public()
  @ApiParam({ name: 'file', description: '32 lower-case hex characters and .png | .jpg | .webp, as named by API-205 or the homepage-images routes', example: '0f1e2d3c4b5a69788796a5b4c3d2e1f0.webp' })
  @ApiProduces(...IMAGE_CONTENT_TYPES)
  @ApiOperation({
    summary: 'Read a published homepage image (public)',
    description:
      'No sign-in, no audit event, no rate limit (a page view shows four pictures). Only a file the current settings reference is served — a replaced or reset picture is 404 at once. ' +
      'The bytes with the stored Content-Type, `Cache-Control: public, max-age=31536000, immutable` (a new upload always has a new name), `X-Content-Type-Options: nosniff`, ' +
      '`Content-Disposition: inline`, `Cross-Origin-Resource-Policy: cross-origin` (a public picture another origin may show) and a strong ETag — an If-None-Match that ' +
      'matches is 304 without reading the file. HEAD answers the headers and the size without reading the file either.',
  })
  @ApiOkResponse({ description: 'The image bytes', schema: { type: 'string', format: 'binary' } })
  @ApiNotModifiedResponse({ description: 'If-None-Match carries the ETag of the picture' })
  @ApiNotFoundResponse({ description: 'media_not_found — a malformed name, a file no homepage image references, or a missing file' })
  async media(@Param('file') file: string, @Req() req: Request, @Res() res: Response): Promise<void> {
    const reference = await this.images.mediaReference(file);
    // Revalidation from the stored reference alone: Express's req.fresh compares If-None-Match with this ETag.
    res.setHeader('ETag', reference.etag);
    if (req.fresh) {
      res.set(this.cacheHeaders()).status(304).end();
      return;
    }
    // Nothing of the picture is promised before the file is found: a 404 must not carry its cache headers.
    res.removeHeader('ETag');
    if (req.method === 'HEAD') {
      const { size } = await this.images.statMedia(reference);
      res.set({ ...this.pictureHeaders(reference.contentType, reference.etag), 'Content-Length': String(size) }).status(200).end();
      return;
    }
    const opened = await this.images.openMedia(reference);
    res.set({ ...this.pictureHeaders(reference.contentType, reference.etag), 'Content-Length': String(opened.size) }).status(200);
    // pipeline() destroys the file stream (closing its descriptor) when the client goes away or a read fails.
    pipeline(opened.stream, res, (error) => {
      if (error && !res.writableFinished) res.destroy();
    });
  }

  /** Headers of a 200 and a 304; they replace helmet's same-origin CORP on this route only. */
  private cacheHeaders(): Record<string, string> {
    return { 'Cache-Control': MEDIA_CACHE_CONTROL, 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'cross-origin' };
  }

  private pictureHeaders(contentType: string, etag: string): Record<string, string> {
    return { ...this.cacheHeaders(), 'Content-Type': contentType, 'Content-Disposition': 'inline', ETag: etag };
  }
}
