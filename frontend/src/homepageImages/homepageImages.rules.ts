// The pure rules of the homepage images tab (Settings → «صور الصفحة الرئيسية»).
// A picture chosen from the computer is checked HERE before any request, as the
// server would check it — a mirror of its rule, never a replacement for it:
// - the type comes from the first bytes (PNG signature, JPEG SOI, WebP `RIFF....WEBP`),
//   never from the file name or the type the browser guessed from it — an SVG, a GIF,
//   a PDF or a renamed program is refused;
// - its size: not empty, at most the server's `maxBytes` (5 MiB);
// - its dimensions, read from the headers (PNG IHDR, JPEG SOFn, WebP VP8/VP8L/VP8X):
//   each side 64..8000 px and at most 40,000,000 pixels. Like the server, a JPEG (APP1
//   Exif) or a PNG (eXIf) whose EXIF orientation is 5..8 is turned a quarter by the
//   browser, so its width and height are swapped before anything is measured or shown.
// The warnings below never block a save: they only tell how the picture will look in
// the frame of its place on /home (HOME_IMAGE_SLOTS — the same frame as the preview).
import type { HomepageImageContentType } from '../api/homepageImages'
import type { HomeImageSlot } from '../publicHome/homeImageSlots'

/** The `accept` of the file picker: the three types the server takes. */
export const PICTURE_ACCEPT = 'image/png,image/jpeg,image/webp'

/** The dimension limits of the server (`image_dimensions_invalid`). */
export const PICTURE_MIN_SIDE = 64
export const PICTURE_MAX_SIDE = 8000
export const PICTURE_MAX_PIXELS = 40_000_000

/** A picture more than 15% wider or narrower than its frame gets a shape warning. */
export const SHAPE_TOLERANCE = 0.15

/** What the headers of an accepted picture say. */
export interface PictureInfo {
  contentType: HomepageImageContentType
  width: number
  height: number
  /** True when the picture can hold transparent pixels (a PNG with an alpha channel or tRNS, a WebP with alpha). */
  alpha: boolean
}

/** Why a chosen file is refused before any request (`unreadable`: the browser could not read it). */
export type PictureRefusal =
  | { reason: 'empty' }
  | { reason: 'unreadable' }
  | { reason: 'tooLarge'; bytes: number; maxBytes: number }
  | { reason: 'unsupported' }
  | { reason: 'corrupt' }
  | { reason: 'dimensions'; width: number; height: number }

export type PictureWarning = 'small' | 'cropped' | 'smaller' | 'jpegNoTransparency' | 'opaqueBackground'

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** The JPEG start-of-frame markers that carry the picture's size (SOF0..SOF15 without DHT C4, JPG C8 and DAC CC). */
const JPEG_SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])

function startsWith(bytes: Uint8Array, prefix: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + prefix.length) return false
  return prefix.every((value, index) => bytes[offset + index] === value)
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  if (bytes.length < offset + length) return ''
  return String.fromCharCode(...bytes.subarray(offset, offset + length))
}

const u16be = (bytes: Uint8Array, offset: number) => (bytes[offset]! << 8) | bytes[offset + 1]!
const u16le = (bytes: Uint8Array, offset: number) => bytes[offset]! | (bytes[offset + 1]! << 8)
const u24le = (bytes: Uint8Array, offset: number) => bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16)
const u32be = (bytes: Uint8Array, offset: number) => ((bytes[offset]! << 24) >>> 0) + ((bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!)
const u32le = (bytes: Uint8Array, offset: number) => (bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) | (bytes[offset + 3]! << 24)) >>> 0

/** The type of a picture by its first bytes, or null when they are not a PNG, a JPEG or a WebP. */
export function detectPictureType(bytes: Uint8Array): HomepageImageContentType | null {
  if (startsWith(bytes, PNG_SIGNATURE)) return 'image/png'
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'image/webp'
  return null
}

type Measured = { width: number; height: number; alpha: boolean; orientation?: number | null } | null

const EXIF_ORIENTATION_TAG = 0x0112
const TIFF_SHORT = 3
const EXIF_IDENTIFIER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00] // 'Exif' and two zero bytes

/**
 * The Orientation tag (1..8) of IFD0 of a TIFF stream — the body of a JPEG's APP1 Exif
 * block or a PNG's eXIf chunk — in either byte order (II little-endian, MM big-endian),
 * or null: a mirror of readExifOrientation() of backend/src/academy/homepage-images.media.ts.
 */
export function readExifOrientation(tiff: Uint8Array): number | null {
  if (tiff.length < 8) return null
  const order = ascii(tiff, 0, 2)
  if (order !== 'II' && order !== 'MM') return null
  const little = order === 'II'
  const u16 = (offset: number) => (little ? u16le(tiff, offset) : u16be(tiff, offset))
  const u32 = (offset: number) => (little ? u32le(tiff, offset) : u32be(tiff, offset))
  if (u16(2) !== 42) return null
  const ifd = u32(4)
  if (ifd < 8 || ifd + 2 > tiff.length) return null
  const count = u16(ifd)
  for (let index = 0; index < count; index += 1) {
    const entry = ifd + 2 + index * 12
    if (entry + 12 > tiff.length) return null
    if (u16(entry) !== EXIF_ORIENTATION_TAG) continue
    if (u16(entry + 2) !== TIFF_SHORT || u32(entry + 4) !== 1) return null
    const value = u16(entry + 8)
    return value >= 1 && value <= 8 ? value : null
  }
  return null
}

function measurePng(bytes: Uint8Array): Measured {
  // The first chunk is IHDR (13 bytes): width, height, bit depth, colour type.
  if (bytes.length < 33 || u32be(bytes, 8) !== 13 || ascii(bytes, 12, 4) !== 'IHDR') return null
  const width = u32be(bytes, 16)
  const height = u32be(bytes, 20)
  const colourType = bytes[25]!
  // Grey + alpha (4) and RGBA (6) carry an alpha channel; any other type may still mark a colour transparent (tRNS).
  let alpha = colourType === 4 || colourType === 6
  // The first eXIf before the image data lends its orientation (as on the server).
  let orientation: number | null = null
  let offset = 8
  while (offset + 8 <= bytes.length) {
    const length = u32be(bytes, offset)
    const type = ascii(bytes, offset + 4, 4)
    if (type === 'IDAT' || type === 'IEND') break
    if (type === 'tRNS') alpha = true
    if (type === 'eXIf' && orientation === null) orientation = readExifOrientation(bytes.subarray(offset + 8, Math.min(bytes.length, offset + 8 + length)))
    offset += 12 + length
  }
  return { width, height, alpha, orientation }
}

/**
 * The frame size of a JPEG and the orientation of its first APP1 Exif block — read up to the
 * first scan (an EXIF block after the image data is not looked for).
 */
function measureJpeg(bytes: Uint8Array): Measured {
  let frame: { width: number; height: number } | null = null
  let orientation: number | null = null
  const found = () => (frame ? { ...frame, alpha: false, orientation } : null)
  let offset = 2
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) return null
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1
    const marker = bytes[offset]
    offset += 1
    if (marker === undefined) return null
    // Markers without a segment: TEM, RSTn, a second SOI.
    if (marker === 0x01 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) continue
    // The image data or its end: the frame header must have come first.
    if (marker === 0xd9 || marker === 0xda) return found()
    if (offset + 2 > bytes.length) return found()
    const length = u16be(bytes, offset)
    if (length < 2) return null
    if (JPEG_SOF_MARKERS.has(marker)) {
      if (frame) return null
      if (offset + 7 > bytes.length) return null
      frame = { width: u16be(bytes, offset + 5), height: u16be(bytes, offset + 3) }
    } else if (marker === 0xe1 && orientation === null && startsWith(bytes, EXIF_IDENTIFIER, offset + 2)) {
      const tiffStart = offset + 2 + EXIF_IDENTIFIER.length
      orientation = readExifOrientation(bytes.subarray(tiffStart, Math.min(bytes.length, offset + length)))
    }
    offset += length
  }
  return found()
}

function measureWebp(bytes: Uint8Array): Measured {
  const chunk = ascii(bytes, 12, 4)
  if (chunk === 'VP8 ') {
    // A lossy frame: its key-frame start code, then the 14-bit width and height.
    if (bytes.length < 30 || !startsWith(bytes, [0x9d, 0x01, 0x2a], 23)) return null
    return { width: u16le(bytes, 26) & 0x3fff, height: u16le(bytes, 28) & 0x3fff, alpha: false }
  }
  if (chunk === 'VP8L') {
    // A lossless frame: its signature, then width-1 and height-1 (14 bits each) and the alpha hint.
    if (bytes.length < 25 || bytes[20] !== 0x2f) return null
    const bits = u32le(bytes, 21)
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1, alpha: ((bits >>> 28) & 1) === 1 }
  }
  if (chunk === 'VP8X') {
    // The extended header: its flags (alpha = 0x10), then the canvas width-1 and height-1 (24 bits each).
    if (bytes.length < 30) return null
    return { width: u24le(bytes, 24) + 1, height: u24le(bytes, 27) + 1, alpha: (bytes[20]! & 0x10) !== 0 }
  }
  return null
}

/** A size the browser lets through (an empty file, one over the server's limit), or null. */
export function sizeRefusal(bytes: number, maxBytes: number): PictureRefusal | null {
  if (bytes <= 0) return { reason: 'empty' }
  if (bytes > maxBytes) return { reason: 'tooLarge', bytes, maxBytes }
  return null
}

/** Reads a picture's type and size from its bytes, or says why it is refused. */
export function inspectPicture(bytes: Uint8Array): { info: PictureInfo } | { refusal: PictureRefusal } {
  if (bytes.length === 0) return { refusal: { reason: 'empty' } }
  const contentType = detectPictureType(bytes)
  if (!contentType) return { refusal: { reason: 'unsupported' } }
  const measured = contentType === 'image/png' ? measurePng(bytes) : contentType === 'image/jpeg' ? measureJpeg(bytes) : measureWebp(bytes)
  if (!measured || measured.width <= 0 || measured.height <= 0) return { refusal: { reason: 'corrupt' } }
  // Orientations 5..8 turn the picture a quarter: the browser shows it the other way round.
  const turned = (measured.orientation ?? 0) >= 5
  const width = turned ? measured.height : measured.width
  const height = turned ? measured.width : measured.height
  if (width < PICTURE_MIN_SIDE || height < PICTURE_MIN_SIDE || width > PICTURE_MAX_SIDE || height > PICTURE_MAX_SIDE || width * height > PICTURE_MAX_PIXELS) {
    return { refusal: { reason: 'dimensions', width, height } }
  }
  return { info: { contentType, width, height, alpha: measured.alpha } }
}

/** How much wider (> 1) or narrower (< 1) than its frame the picture is. */
export function shapeRatio(slot: Pick<HomeImageSlot, 'width' | 'height'>, info: Pick<PictureInfo, 'width' | 'height'>): number {
  return info.width / info.height / (slot.width / slot.height)
}

/** True when the picture is more than SHAPE_TOLERANCE wider or narrower than its frame. */
export function shapeDiffers(slot: Pick<HomeImageSlot, 'width' | 'height'>, info: Pick<PictureInfo, 'width' | 'height'>): boolean {
  const ratio = shapeRatio(slot, info)
  return Math.max(ratio, 1 / ratio) > 1 + SHAPE_TOLERANCE
}

/**
 * The warnings of a chosen picture against the frame of its place, in the order they
 * are shown: smaller than the recommended size; a shape other than the frame's (a
 * `cover` frame hides the edges, a `contain` frame shows the picture smaller); and for
 * the hero (a cut-out person on a transparent background) a JPEG, or a picture that
 * cannot hold a transparent pixel. The check of an opaque background by its corners
 * (a canvas, in the browser only) adds `opaqueBackground` later — withOpaqueCorners().
 */
export function pictureWarnings(slot: HomeImageSlot, info: PictureInfo): PictureWarning[] {
  const warnings: PictureWarning[] = []
  if (info.width < slot.width || info.height < slot.height) warnings.push('small')
  if (shapeDiffers(slot, info)) warnings.push(slot.fit === 'cover' ? 'cropped' : 'smaller')
  if (slot.transparent) {
    if (info.contentType === 'image/jpeg') warnings.push('jpegNoTransparency')
    else if (!info.alpha) warnings.push('opaqueBackground')
  }
  return warnings
}

/** The warnings once the corners of the picture were found fully opaque (each warning once). */
export function withOpaqueCorners(warnings: readonly PictureWarning[]): PictureWarning[] {
  return warnings.includes('opaqueBackground') || warnings.includes('jpegNoTransparency') ? [...warnings] : [...warnings, 'opaqueBackground']
}

/** True when the four corner pixels (RGBA, in the order the canvas reads them) are all fully opaque. */
export function cornersOpaque(rgba: ArrayLike<number>): boolean {
  if (rgba.length < 16) return false
  return [3, 7, 11, 15].every((index) => rgba[index] === 255)
}

/** The short name of a type for the screen. */
export function pictureTypeLabel(contentType: string | null): string {
  if (contentType === 'image/png') return 'PNG'
  if (contentType === 'image/jpeg') return 'JPEG'
  if (contentType === 'image/webp') return 'WebP'
  return contentType ?? ''
}

/**
 * A file size in the unit the screen shows it: kilobytes below one megabyte (at least 1),
 * megabytes with one decimal above — rounded UP, so a file one byte over the 5 MB limit
 * never reads «5 MB» beside the limit.
 */
export function fileSizeParts(bytes: number): { unit: 'kb' | 'mb'; value: number } {
  const mebibyte = 1024 * 1024
  if (bytes >= mebibyte) return { unit: 'mb', value: Math.ceil((bytes / mebibyte) * 10 - 1e-9) / 10 }
  return { unit: 'kb', value: Math.max(1, Math.ceil(bytes / 1024 - 1e-9)) }
}

/** Keeps a left-to-right value (`760 × 981`) in its order inside an Arabic sentence (Unicode isolates, KI-110). */
export function isolateLtr(text: string): string {
  return `\u2066${text}\u2069`
}

/** `width × height`, isolated left to right. */
export function dimensionsText(width: number, height: number): string {
  return isolateLtr(`${width} × ${height}`)
}

/**
 * The address of a published picture for an <img>: the server's root-relative
 * `/api/academy/media/<file>` (through the API base of this build), else null —
 * the default picture of the place shows instead.
 */
export function publishedSrc(url: string | null | undefined, apiUrl: (path: string) => string): string | null {
  return typeof url === 'string' && url.startsWith('/api/academy/media/') ? apiUrl(url) : null
}
