// Test data of the homepage images tab: the server's answers (HomepageImagesDto) and
// small real picture headers — enough bytes for the type and the size to be read, as
// the browser hands them over (CRCs and pixel data are not checked on this side).
import type { HomepageImage, HomepageImages } from '../api/homepageImages'
import { HOME_IMAGE_KEYS } from '../publicHome/homeImageSlots'
import type { HomeImageKey } from '../publicHome/homeImageSlots'

export const MEDIA_FILE = '0123456789abcdef0123456789abcdef'

/** The state of one place: the default unless overridden. */
export function makeHomepageImage(key: HomeImageKey, overrides: Partial<HomepageImage> = {}): HomepageImage {
  return { key, custom: false, url: null, contentType: null, width: null, height: null, bytes: null, updatedAt: null, ...overrides }
}

/** A place with the academy's own picture. */
export function customImage(key: HomeImageKey, overrides: Partial<HomepageImage> = {}): HomepageImage {
  return makeHomepageImage(key, {
    custom: true,
    url: `/api/academy/media/${MEDIA_FILE}.png`,
    contentType: 'image/png',
    width: 1520,
    height: 1962,
    bytes: 812_345,
    updatedAt: '2026-11-20T09:30:00.000Z',
    ...overrides,
  })
}

/** The answer of GET/PUT/DELETE /api/academy/homepage-images: the four places in their order, defaults unless given. */
export function makeHomepageImages(overrides: Partial<Record<HomeImageKey, HomepageImage>> = {}): HomepageImages {
  return {
    items: HOME_IMAGE_KEYS.map((key) => overrides[key] ?? makeHomepageImage(key)),
    maxBytes: 5_242_880,
    contentTypes: ['image/png', 'image/jpeg', 'image/webp'],
  }
}

const u32be = (value: number) => [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]
const u16be = (value: number) => [(value >>> 8) & 0xff, value & 0xff]
const u16le = (value: number) => [value & 0xff, (value >>> 8) & 0xff]
const u24le = (value: number) => [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff]
const u32le = (value: number) => [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff]
const text = (value: string) => [...value].map((char) => char.charCodeAt(0))

/**
 * A TIFF stream as a camera writes it inside EXIF: IFD0 with the Orientation tag (0x0112, SHORT),
 * after a Make tag in the big-endian (MM) one so the reader has to walk past an entry.
 */
export function exifTiff(orientation: number, byteOrder: 'II' | 'MM' = 'II'): number[] {
  const big = byteOrder === 'MM'
  const u16 = big ? u16be : u16le
  const u32 = big ? u32be : u32le
  const make = big ? [...u16(0x010f), ...u16(2), ...u32(4), 0x43, 0x61, 0x6d, 0x00] : []
  const orientationEntry = [...u16(0x0112), ...u16(3), ...u32(1), ...u16(orientation), 0, 0]
  return [...text(byteOrder), ...u16(42), ...u32(8), ...u16(big ? 2 : 1), ...make, ...orientationEntry, ...u32(0)]
}

function pngChunk(type: string, data: number[]): number[] {
  return [...u32be(data.length), ...text(type), ...data, 0, 0, 0, 0]
}

interface ExifOptions {
  /** An EXIF orientation (1..8) carried by the file — PNG eXIf, JPEG APP1 Exif. */
  orientation?: number
  byteOrder?: 'II' | 'MM'
}

/** A PNG: signature, IHDR (colour type 6 = RGBA by default), an optional eXIf and tRNS, an empty IDAT and IEND. */
export function pngBytes({
  width = 760,
  height = 981,
  colourType = 6,
  tRNS = false,
  orientation,
  byteOrder,
}: { width?: number; height?: number; colourType?: number; tRNS?: boolean } & ExifOptions = {}): Uint8Array<ArrayBuffer> {
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...pngChunk('IHDR', [...u32be(width), ...u32be(height), 8, colourType, 0, 0, 0]),
    ...(orientation === undefined ? [] : pngChunk('eXIf', exifTiff(orientation, byteOrder))),
    ...(tRNS ? pngChunk('tRNS', [0]) : []),
    ...pngChunk('IDAT', []),
    ...pngChunk('IEND', []),
  ])
}

/**
 * A JPEG: SOI, an optional EXIF segment before the frame (a stub, or a real TIFF stream with
 * an orientation), SOF0 (or SOF2 = progressive) with the size, SOS, EOI.
 */
export function jpegBytes({
  width = 960,
  height = 680,
  exif = false,
  progressive = false,
  orientation,
  byteOrder,
}: { width?: number; height?: number; exif?: boolean; progressive?: boolean } & ExifOptions = {}): Uint8Array<ArrayBuffer> {
  const tiff = orientation === undefined ? [1, 2, 3, 4] : exifTiff(orientation, byteOrder)
  const app1 = exif || orientation !== undefined ? [0xff, 0xe1, ...u16be(2 + 6 + tiff.length), ...text('Exif'), 0, 0, ...tiff] : []
  return new Uint8Array([
    0xff, 0xd8,
    ...app1,
    0xff, progressive ? 0xc2 : 0xc0, ...u16be(17), 8, ...u16be(height), ...u16be(width), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1,
    0xff, 0xda, ...u16be(8), 1, 1, 0, 0, 0x3f, 0,
    0xff, 0xd9,
  ])
}

function riff(chunk: string, payload: number[]): Uint8Array<ArrayBuffer> {
  const body = [...text('WEBP'), ...text(chunk), ...u32le(payload.length), ...payload]
  return new Uint8Array([...text('RIFF'), ...u32le(body.length), ...body])
}

/** A WebP of each kind: lossy `VP8 `, lossless `VP8L` (alpha hint) or extended `VP8X` (alpha flag). */
export function webpBytes({ kind = 'VP8X', width = 900, height = 560, alpha = false }: { kind?: 'VP8 ' | 'VP8L' | 'VP8X'; width?: number; height?: number; alpha?: boolean } = {}): Uint8Array<ArrayBuffer> {
  if (kind === 'VP8 ') return riff('VP8 ', [0x30, 0x01, 0x00, 0x9d, 0x01, 0x2a, ...u16le(width), ...u16le(height)])
  if (kind === 'VP8L') {
    const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14) | ((alpha ? 1 : 0) << 28)
    return riff('VP8L', [0x2f, ...u32le(bits >>> 0)])
  }
  return riff('VP8X', [alpha ? 0x10 : 0, 0, 0, 0, ...u24le(width - 1), ...u24le(height - 1)])
}

export const SVG_BYTES = new Uint8Array(text('<svg xmlns="http://www.w3.org/2000/svg" width="760" height="981"></svg>'))
export const GIF_BYTES = new Uint8Array([...text('GIF89a'), ...u16le(800), ...u16le(760), 0, 0, 0])
export const PDF_BYTES = new Uint8Array(text('%PDF-1.7\n%âãÏÓ\n'))
/** A Windows program renamed `.png`: its first bytes are `MZ`. */
export const EXE_BYTES = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00])

/** A file as the browser hands it over: the type it guessed from the name. */
export function pictureFile(bytes: Uint8Array<ArrayBuffer>, name: string, type: string): File {
  return new File([bytes], name, { type })
}
