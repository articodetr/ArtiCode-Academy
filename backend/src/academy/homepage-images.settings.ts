// Homepage images (MOD-02/MOD-14): the references stored under
// `academy.settings.homepageImages.<key>` — never the bytes, which live in the
// media directory (media-storage.service.ts). The domain is NOT one of the
// PATCH-able settings of academy.settings.ts: readSettings() ignores it and
// applySettingsChanges() keeps it untouched, so `PATCH /api/academy` can
// neither read nor write it; only the homepage-images routes do.
//
// Reading is lenient like readSettings(): a stored value that fails the schema
// reads as "no custom picture" (the default is shown) instead of failing.
import { z } from 'zod';
import { IMAGE_CONTENT_TYPES, IMAGE_EXTENSIONS } from './homepage-images.media.js';
import type { ImageContentType } from './homepage-images.media.js';

/** The four places of the public home page `/home`, in the order the API lists them. */
export const HOMEPAGE_IMAGE_KEYS = ['heroStudent', 'aboutLearners', 'promoTraining', 'whyClassroom'] as const;
export type HomepageImageKey = (typeof HOMEPAGE_IMAGE_KEYS)[number];

/** The settings domain that holds the references. */
export const HOMEPAGE_IMAGES_DOMAIN = 'homepageImages';

/** A stored file name: 32 random lower-case hex characters and the extension of the detected type. */
export const MEDIA_FILE_PATTERN = /^[0-9a-f]{32}\.(png|jpg|webp)$/;

export function isHomepageImageKey(value: unknown): value is HomepageImageKey {
  return typeof value === 'string' && (HOMEPAGE_IMAGE_KEYS as readonly string[]).includes(value);
}

export function isMediaFileName(value: unknown): value is string {
  return typeof value === 'string' && MEDIA_FILE_PATTERN.test(value);
}

/** One stored reference; the extension of `file` must be the one of `contentType`. */
export const homepageImageReferenceSchema = z
  .object({
    file: z.string().regex(MEDIA_FILE_PATTERN),
    contentType: z.enum(IMAGE_CONTENT_TYPES),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    bytes: z.number().int().positive(),
    updatedAt: z.iso.datetime(),
  })
  .refine((ref) => ref.file.endsWith(`.${IMAGE_EXTENSIONS[ref.contentType]}`), { message: 'the file extension must match the content type' });

export interface HomepageImageReference {
  file: string;
  contentType: ImageContentType;
  width: number;
  height: number;
  bytes: number;
  updatedAt: string;
}

export type HomepageImageReferences = Record<HomepageImageKey, HomepageImageReference | null>;

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : {};
}

/** The stored settings → the reference of each key (null = the built-in default; a corrupt value reads as null). */
export function readHomepageImages(settings: unknown): HomepageImageReferences {
  const domain = asObject(asObject(settings)[HOMEPAGE_IMAGES_DOMAIN]);
  const out = {} as HomepageImageReferences;
  for (const key of HOMEPAGE_IMAGE_KEYS) {
    const parsed = homepageImageReferenceSchema.safeParse(domain[key]);
    out[key] = parsed.success ? { ...parsed.data } : null;
  }
  return out;
}

/** True when the settings carry anything at all under the key, valid or not (so a reset can clear a corrupt value). */
export function hasStoredHomepageImage(settings: unknown, key: HomepageImageKey): boolean {
  return Object.hasOwn(asObject(asObject(settings)[HOMEPAGE_IMAGES_DOMAIN]), key);
}

/**
 * A copy of the settings with the key set to `reference`, or removed for
 * `null`. Every other settings domain and every other key (known or not) is
 * kept as it is; a domain left empty is removed, like applySettingsChanges().
 */
export function writeHomepageImage(settings: unknown, key: HomepageImageKey, reference: HomepageImageReference | null): JsonObject {
  const next: JsonObject = structuredClone(asObject(settings));
  const domain: JsonObject = { ...asObject(next[HOMEPAGE_IMAGES_DOMAIN]) };
  if (reference === null) delete domain[key];
  else domain[key] = { ...reference };
  if (Object.keys(domain).length === 0) delete next[HOMEPAGE_IMAGES_DOMAIN];
  else next[HOMEPAGE_IMAGES_DOMAIN] = domain;
  return next;
}

/** The valid reference that names `file`, or null — only a referenced file is ever served. */
export function referenceOfFile(settings: unknown, file: string): HomepageImageReference | null {
  if (!isMediaFileName(file)) return null;
  const references = readHomepageImages(settings);
  for (const key of HOMEPAGE_IMAGE_KEYS) {
    const reference = references[key];
    if (reference?.file === file) return reference;
  }
  return null;
}

/** True when some key of the settings still references `file`. */
export function isFileReferenced(settings: unknown, file: string): boolean {
  return referenceOfFile(settings, file) !== null;
}

/** `/<prefix>/academy/media/<file>` — root-relative, below the API prefix (`api` by default). */
export function mediaUrl(apiPrefix: string, file: string): string {
  const prefix = apiPrefix.replace(/^\/+|\/+$/g, '');
  return `${prefix === '' ? '' : `/${prefix}`}/academy/media/${file}`;
}

/** API-205: the public URL of each key's own picture, null = the built-in default. Nothing else about the files. */
export function publicHomepageImageUrls(settings: unknown, apiPrefix: string): Record<HomepageImageKey, string | null> {
  const references = readHomepageImages(settings);
  const out = {} as Record<HomepageImageKey, string | null>;
  for (const key of HOMEPAGE_IMAGE_KEYS) {
    const reference = references[key];
    out[key] = reference ? mediaUrl(apiPrefix, reference.file) : null;
  }
  return out;
}
