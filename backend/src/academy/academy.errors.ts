// Error vocabulary of MOD-02/MOD-14 (academy identity and settings). Same
// shape as AuthHttpException / UsersHttpException: the body is
// `{ statusCode, error, code, message, ...details }` and the frontend maps the
// stable `code` to a localized message.
//
//   academy_not_configured  503  — the single `academy` row is missing (the
//                                  database was never seeded); an operator
//                                  action (`npm run prisma:seed`), not a client
//                                  one, so 503 like the readiness probe rather
//                                  than a 409 the client could resolve.
//   nothing_to_update       400  — PATCH body without any field (same code and
//                                  meaning as API-018/API-025).
//
// Homepage images (Settings → «صور الصفحة الرئيسية»):
//   homepage_image_unknown  404  — the :key is not one of the four places
//                                  { key, keys }.
//   image_type_unsupported  415  — the Content-Type is not image/png,
//                                  image/jpeg or image/webp { contentTypes }.
//   image_invalid           400  — the body is empty, or its bytes are not a
//                                  well-formed PNG/JPEG/WebP, or not the declared
//                                  type { reason: empty | unrecognized |
//                                  type_mismatch | corrupt }.
//   image_too_large         413  — the body is over 5 MiB { maxBytes } (also
//                                  answered by the route's raw body parser).
//   image_dimensions_invalid 400 — a side outside 64..8000 px or more than 40
//                                  million pixels { width, height, minSide,
//                                  maxSide, maxPixels }.
//   media_storage_unavailable 503 — the media directory cannot be created or
//                                  written (an operator action).
//   media_not_found         404  — GET /api/academy/media/:file for a name that
//                                  is malformed, not referenced by the current
//                                  settings, or missing on disk.
import { HttpException, HttpStatus } from '@nestjs/common';
import { STATUS_CODES } from 'node:http';
import { IMAGE_TOO_LARGE_CODE, IMAGE_TOO_LARGE_MESSAGE } from './homepage-images.limits.js';

export const ACADEMY_ERROR_CODES = [
  'academy_not_configured',
  'nothing_to_update',
  'homepage_image_unknown',
  'image_type_unsupported',
  'image_invalid',
  'image_too_large',
  'image_dimensions_invalid',
  'media_storage_unavailable',
  'media_not_found',
] as const;

/** The reason of a 400 image_invalid. */
export type ImageInvalidReason = 'empty' | 'unrecognized' | 'type_mismatch' | 'corrupt';

export type AcademyErrorCode = (typeof ACADEMY_ERROR_CODES)[number];

export interface AcademyErrorBody {
  statusCode: number;
  error: string;
  code: AcademyErrorCode;
  message: string;
  [detail: string]: unknown;
}

/** HttpException whose body is `{ statusCode, error, code, message, ...details }`. */
export class AcademyHttpException extends HttpException {
  readonly code: AcademyErrorCode;

  constructor(status: HttpStatus, code: AcademyErrorCode, message: string, details: Record<string, unknown> = {}) {
    const body: AcademyErrorBody = {
      statusCode: status,
      error: STATUS_CODES[status] ?? 'Error',
      code,
      message,
      ...details,
    };
    super(body, status);
    this.code = code;
  }
}

export const academyError = {
  notConfigured: () =>
    new AcademyHttpException(
      HttpStatus.SERVICE_UNAVAILABLE,
      'academy_not_configured',
      'This database holds no academy row yet; run the seed (npm run prisma:seed) before using the API',
    ),
  nothingToUpdate: () =>
    new AcademyHttpException(HttpStatus.BAD_REQUEST, 'nothing_to_update', 'The request body contains no field to update'),
  homepageImageUnknown: (key: string, keys: readonly string[]) =>
    new AcademyHttpException(HttpStatus.NOT_FOUND, 'homepage_image_unknown', 'There is no homepage image with this key', { key, keys: [...keys] }),
  imageTypeUnsupported: (contentTypes: readonly string[]) =>
    new AcademyHttpException(
      HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      'image_type_unsupported',
      'The request body must be the image itself, sent as image/png, image/jpeg or image/webp',
      { contentTypes: [...contentTypes] },
    ),
  imageInvalid: (reason: ImageInvalidReason) =>
    new AcademyHttpException(HttpStatus.BAD_REQUEST, 'image_invalid', IMAGE_INVALID_MESSAGES[reason], { reason }),
  imageTooLarge: (maxBytes: number) =>
    // The raw parser of configureApp() answers the same body (homepage-images.limits.ts).
    new AcademyHttpException(HttpStatus.PAYLOAD_TOO_LARGE, IMAGE_TOO_LARGE_CODE, IMAGE_TOO_LARGE_MESSAGE, { maxBytes }),
  imageDimensionsInvalid: (width: number, height: number, limits: { minSide: number; maxSide: number; maxPixels: number }) =>
    new AcademyHttpException(HttpStatus.BAD_REQUEST, 'image_dimensions_invalid', 'Each side of the image must be within the accepted range, and its pixel count within the maximum', {
      width,
      height,
      minSide: limits.minSide,
      maxSide: limits.maxSide,
      maxPixels: limits.maxPixels,
    }),
  mediaStorageUnavailable: () =>
    new AcademyHttpException(
      HttpStatus.SERVICE_UNAVAILABLE,
      'media_storage_unavailable',
      'The server cannot store images right now (its media directory is not writable); the published pictures are unchanged',
    ),
  mediaNotFound: () => new AcademyHttpException(HttpStatus.NOT_FOUND, 'media_not_found', 'There is no published image with this name'),
};

const IMAGE_INVALID_MESSAGES: Record<ImageInvalidReason, string> = {
  empty: 'The request body is empty: send the image bytes',
  unrecognized: 'The file is not a PNG, JPEG or WebP image',
  type_mismatch: 'The file is not of the type its Content-Type declares',
  corrupt: 'The image file is damaged or incomplete',
};
