// Homepage images: the upload limits and the media types, in a file WITHOUT
// imports. configureApp() (src/app.setup.ts) reads them for the route-scoped
// raw body parser; the file is shared with the platform application's import
// graph, which must not load any academy module (ADR-073), so it stays
// dependency-free. homepage-images.media.ts re-exports everything here.

/** The accepted media types, in the order the API lists them. */
export const IMAGE_CONTENT_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type ImageContentType = (typeof IMAGE_CONTENT_TYPES)[number];

/** 5 MiB: the largest upload the raw body parser reads and the service accepts. */
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/** The stable code and message of the 413 of an upload over IMAGE_MAX_BYTES (academy.errors.ts and the raw parser). */
export const IMAGE_TOO_LARGE_CODE = 'image_too_large';
export const IMAGE_TOO_LARGE_MESSAGE = 'The image is larger than the accepted maximum';

/** `image/png; charset=binary` → `image/png`; anything but the three types → null. */
export function imageContentTypeOf(header: string | string[] | undefined): ImageContentType | null {
  if (typeof header !== 'string') return null;
  const type = header.split(';', 1)[0]!.trim().toLowerCase();
  return (IMAGE_CONTENT_TYPES as readonly string[]).includes(type) ? (type as ImageContentType) : null;
}

/**
 * True when the request names a bearer token at all (`Authorization: Bearer
 * <something>`). The raw parser reads an upload only then, so an anonymous
 * request reaches the guards — and their 401 — without its body being read.
 * Whether the token is valid is the AuthGuard's question, not this one.
 */
export function hasBearerCredentials(header: string | string[] | undefined): boolean {
  return typeof header === 'string' && /^Bearer\s+\S+/i.test(header);
}
