// Homepage images (MOD-02/MOD-14): the pure byte rules of an uploaded picture.
// No framework, no file system, no database — the controller, the service and
// configureApp() (the route-scoped raw body parser) all read these.
//
// What a picture is decided from its BYTES, never from its name or the
// Content-Type alone: the magic number says which format it claims to be, and
// a structural parse of that format (PNG chunks with their CRCs, JPEG
// segments and scans, WebP RIFF chunks and the VP8/VP8L headers) says whether
// it is well formed and how large it is. Anything else — SVG, GIF, HTML, an
// executable, a truncated or forged file — is refused.
//
// The stored copy loses its metadata without being re-encoded: the pixel data
// is copied byte for byte, only metadata containers are left out, so a photo's
// GPS position, camera serial, author or editing history is never published.
//   PNG   — chunks kept from an allow-list (the critical ones, transparency,
//           colour, physical size and the APNG animation chunks); tEXt, zTXt,
//           iTXt, eXIf, tIME and every unknown ancillary chunk are dropped.
//   JPEG  — the JFIF header of APP0 (rewritten with a 0 × 0 thumbnail), the
//           ICC profile of APP2 and APP14 (Adobe colour transform) are kept;
//           APP1 (EXIF/XMP), APP13 (IPTC), COM, JFXX and every other APPn,
//           and the MPF index of APP2 are dropped.
//   WebP  — EXIF, XMP and unknown chunks are dropped, the EXIF/XMP flags of
//           VP8X are cleared and the RIFF size is recomputed.
// Bytes after the end of the image (PNG IEND, JPEG EOI, the RIFF size) are
// dropped too, so nothing can be appended to a picture and served with it.
// The EXIF orientation of a JPEG or a PNG is the one value that changes what a
// browser shows: it is kept as a minimal EXIF block holding that tag alone.
import { Buffer } from 'node:buffer';
import { crc32 } from 'node:zlib';
import type { ImageContentType } from './homepage-images.limits.js';

// The media types, the size limit and the Content-Type rule live in the
// dependency-free homepage-images.limits.ts (configureApp() reads them).
export { IMAGE_CONTENT_TYPES, IMAGE_MAX_BYTES, imageContentTypeOf } from './homepage-images.limits.js';
export type { ImageContentType } from './homepage-images.limits.js';

/** File extension of each type (the stored file name is `<32 hex>.<extension>`). */
export const IMAGE_EXTENSIONS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' } as const satisfies Record<ImageContentType, string>;
export type ImageExtension = (typeof IMAGE_EXTENSIONS)[ImageContentType];

/** Each side 64..8000 px and at most 40 million pixels. */
export const IMAGE_LIMITS = { minSide: 64, maxSide: 8000, maxPixels: 40_000_000 } as const;

/** Why bytes are not an accepted picture. */
export type ImageRefusal = 'unrecognized' | 'type_mismatch' | 'corrupt';

export interface CleanImage {
  contentType: ImageContentType;
  extension: ImageExtension;
  /** Width as a browser shows it (pixel width, or height for an orientation that turns the picture). */
  width: number;
  height: number;
  /** The bytes to store: metadata removed, pixel data untouched. */
  bytes: Buffer;
}

export type ImageInspection = { ok: true; image: CleanImage } | { ok: false; reason: ImageRefusal };

/** A parsed picture: its pixel size, its EXIF orientation (1..8) when it carried one, and the cleaned bytes. */
export interface ParsedImage {
  width: number;
  height: number;
  orientation: number | null;
  bytes: Buffer;
}

/** True when both sides are 64..8000 px and the picture holds at most 40 million pixels. */
export function dimensionsAllowed(width: number, height: number): boolean {
  const { minSide, maxSide, maxPixels } = IMAGE_LIMITS;
  return width >= minSide && width <= maxSide && height >= minSide && height <= maxSide && width * height <= maxPixels;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** The format the first bytes claim (a magic number only — the structure is checked by the parsers). */
export function sniffImageType(bytes: Uint8Array): ImageContentType | null {
  const data = asBuffer(bytes);
  if (data.length >= PNG_SIGNATURE.length && data.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return 'image/png';
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (data.length >= 12 && data.toString('latin1', 0, 4) === 'RIFF' && data.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/**
 * The whole rule for an upload whose Content-Type is `declared`: the sniffed
 * format must be one of the three (`unrecognized`), equal to the declared one
 * (`type_mismatch`) and well formed (`corrupt`). The dimensions are NOT checked
 * here (they have their own error, see dimensionsAllowed()).
 */
export function inspectImage(bytes: Uint8Array, declared: ImageContentType): ImageInspection {
  const data = asBuffer(bytes);
  const sniffed = sniffImageType(data);
  if (sniffed === null) return { ok: false, reason: 'unrecognized' };
  if (sniffed !== declared) return { ok: false, reason: 'type_mismatch' };
  const parsed = sniffed === 'image/png' ? cleanPng(data) : sniffed === 'image/jpeg' ? cleanJpeg(data) : cleanWebp(data);
  if (parsed === null) return { ok: false, reason: 'corrupt' };
  // Orientations 5..8 turn the picture a quarter: the browser shows it the other way round.
  const turned = parsed.orientation !== null && parsed.orientation >= 5;
  return {
    ok: true,
    image: {
      contentType: sniffed,
      extension: IMAGE_EXTENSIONS[sniffed],
      width: turned ? parsed.height : parsed.width,
      height: turned ? parsed.width : parsed.height,
      bytes: parsed.bytes,
    },
  };
}

function asBuffer(bytes: Uint8Array): Buffer {
  return Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

// ---------------------------------------------------------------------------
// EXIF orientation
// ---------------------------------------------------------------------------

const ORIENTATION_TAG = 0x0112;
const TIFF_SHORT = 3;

/** The Orientation tag (1..8) of IFD0 of a TIFF stream (the body of an EXIF block), or null. */
export function readExifOrientation(tiff: Uint8Array): number | null {
  const data = asBuffer(tiff);
  if (data.length < 8) return null;
  const order = data.toString('latin1', 0, 2);
  if (order !== 'II' && order !== 'MM') return null;
  const little = order === 'II';
  const u16 = (offset: number) => (little ? data.readUInt16LE(offset) : data.readUInt16BE(offset));
  const u32 = (offset: number) => (little ? data.readUInt32LE(offset) : data.readUInt32BE(offset));
  if (u16(2) !== 42) return null;
  const ifd = u32(4);
  if (ifd < 8 || ifd + 2 > data.length) return null;
  const count = u16(ifd);
  for (let index = 0; index < count; index += 1) {
    const entry = ifd + 2 + index * 12;
    if (entry + 12 > data.length) return null;
    if (u16(entry) !== ORIENTATION_TAG) continue;
    if (u16(entry + 2) !== TIFF_SHORT || u32(entry + 4) !== 1) return null;
    const value = u16(entry + 8);
    return value >= 1 && value <= 8 ? value : null;
  }
  return null;
}

/** A little-endian TIFF stream whose IFD0 holds the Orientation tag alone (26 bytes). */
export function orientationTiff(orientation: number): Buffer {
  const tiff = Buffer.alloc(26);
  tiff.write('II', 0, 'latin1');
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4); // IFD0 right after the header
  tiff.writeUInt16LE(1, 8); // one entry
  tiff.writeUInt16LE(ORIENTATION_TAG, 10);
  tiff.writeUInt16LE(TIFF_SHORT, 12);
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt16LE(orientation, 18); // value, left-justified in the 4-byte field
  tiff.writeUInt32LE(0, 22); // no next IFD
  return tiff;
}

/** Only an orientation that changes the picture (2..8) is worth keeping. */
function keepsOrientation(orientation: number | null): orientation is number {
  return orientation !== null && orientation >= 2 && orientation <= 8;
}

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

/** Ancillary chunks that only describe how the pixels look or move — kept. Everything else ancillary is dropped. */
const PNG_KEPT_ANCILLARY = new Set([
  'tRNS',
  'cHRM',
  'gAMA',
  'iCCP',
  'sBIT',
  'sRGB',
  'cICP',
  'mDCv',
  'cLLI',
  'bKGD',
  'hIST',
  'pHYs',
  'sPLT',
  // APNG
  'acTL',
  'fcTL',
  'fdAT',
]);

/** Allowed bit depths of each colour type (PNG specification, table 11.1). */
const PNG_BIT_DEPTHS: Record<number, readonly number[]> = {
  0: [1, 2, 4, 8, 16],
  2: [8, 16],
  3: [1, 2, 4, 8],
  4: [8, 16],
  6: [8, 16],
};

const PNG_MAX_DIMENSION = 0x7fffffff;

function pngChunk(type: string, data: Buffer): Buffer {
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, 'latin1');
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.length)), 8 + data.length);
  return chunk;
}

/**
 * Parses a PNG chunk by chunk (lengths, types, CRCs, IHDR first, a valid
 * IHDR, PLTE rules, at least one IDAT, IEND last) and rebuilds it from the
 * kept chunks. null = not a well-formed PNG.
 */
export function cleanPng(bytes: Uint8Array): ParsedImage | null {
  const src = asBuffer(bytes);
  if (src.length < PNG_SIGNATURE.length || !src.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return null;
  const kept: Buffer[] = [PNG_SIGNATURE];
  let header: { width: number; height: number; colorType: number } | null = null;
  let sawPalette = false;
  let sawData = false;
  let ended = false;
  let orientation: number | null = null;
  let offset = PNG_SIGNATURE.length;

  while (offset < src.length) {
    if (offset + 12 > src.length) return null;
    const length = src.readUInt32BE(offset);
    if (length > 0x7fffffff) return null;
    const type = src.toString('latin1', offset + 4, offset + 8);
    if (!/^[A-Za-z]{4}$/.test(type)) return null;
    const end = offset + 12 + length;
    if (end > src.length) return null;
    const data = src.subarray(offset + 8, offset + 8 + length);
    if (crc32(src.subarray(offset + 4, offset + 8 + length)) !== src.readUInt32BE(offset + 8 + length)) return null;
    const chunk = src.subarray(offset, end);
    offset = end;

    if (header === null) {
      if (type !== 'IHDR' || length !== 13) return null;
      const width = data.readUInt32BE(0);
      const height = data.readUInt32BE(4);
      const [bitDepth, colorType, compression, filter, interlace] = [data[8]!, data[9]!, data[10]!, data[11]!, data[12]!];
      if (width === 0 || height === 0 || width > PNG_MAX_DIMENSION || height > PNG_MAX_DIMENSION) return null;
      if (!PNG_BIT_DEPTHS[colorType]?.includes(bitDepth) || compression !== 0 || filter !== 0 || interlace > 1) return null;
      header = { width, height, colorType };
      kept.push(chunk);
      continue;
    }
    switch (type) {
      case 'IHDR':
        return null; // a second header
      case 'IDAT':
        sawData = true;
        kept.push(chunk);
        continue;
      case 'IEND':
        if (length !== 0) return null;
        kept.push(chunk);
        ended = true;
        break;
      case 'PLTE':
        // Before the image data, once, 1..256 entries, never for greyscale.
        if (sawData || sawPalette || header.colorType === 0 || header.colorType === 4) return null;
        if (length === 0 || length % 3 !== 0 || length > 768) return null;
        sawPalette = true;
        kept.push(chunk);
        continue;
      default:
        // An unknown critical chunk (upper-case first letter) cannot be skipped by a decoder.
        if (type.charCodeAt(0) < 0x61) return null;
        // eXIf is honoured before the image data only; its orientation is kept below.
        if (type === 'eXIf' && !sawData && orientation === null) orientation = readExifOrientation(data);
        if (PNG_KEPT_ANCILLARY.has(type)) kept.push(chunk);
        continue;
    }
    break; // IEND: anything after it is dropped
  }
  if (header === null || !ended || !sawData) return null;
  if (header.colorType === 3 && !sawPalette) return null;
  if (keepsOrientation(orientation)) kept.splice(2, 0, pngChunk('eXIf', orientationTiff(orientation)));
  return { width: header.width, height: header.height, orientation: keepsOrientation(orientation) ? orientation : null, bytes: Buffer.concat(kept) };
}

// ---------------------------------------------------------------------------
// JPEG
// ---------------------------------------------------------------------------

const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;
const APP0 = 0xe0;
const APP1 = 0xe1;
const APP2 = 0xe2;
const APP14 = 0xee;
/** Baseline, extended sequential and progressive Huffman frames — what browsers decode. */
const SUPPORTED_FRAMES = new Set([0xc0, 0xc1, 0xc2]);
/** The other frame types (lossless, hierarchical, arithmetic) — refused. */
const OTHER_FRAMES = new Set([0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
/** Tables and parameters a decoder needs: DHT, DAC, DQT, DRI. */
const TABLE_SEGMENTS = new Set([0xc4, 0xcc, 0xdb, 0xdd]);
const EXIF_IDENTIFIER = Buffer.from('Exif\0\0', 'latin1');
const ICC_IDENTIFIER = Buffer.from('ICC_PROFILE\0', 'latin1');
const JFIF_IDENTIFIER = Buffer.from('JFIF\0', 'latin1');
/** `JFIF\0`, version (2), units (1), X/Y density (2 + 2), thumbnail width and height (1 + 1). */
const JFIF_HEADER_LENGTH = 14;

function startsWith(data: Buffer, prefix: Buffer): boolean {
  return data.length >= prefix.length && data.subarray(0, prefix.length).equals(prefix);
}

/** An APP1 segment `Exif\0\0` + a TIFF stream holding the orientation alone. */
function exifSegment(orientation: number): Buffer {
  const body = Buffer.concat([EXIF_IDENTIFIER, orientationTiff(orientation)]);
  const segment = Buffer.alloc(4 + body.length);
  segment[0] = 0xff;
  segment[1] = APP1;
  segment.writeUInt16BE(2 + body.length, 2);
  body.copy(segment, 4);
  return segment;
}

/**
 * The JFIF APP0 rewritten without its thumbnail: the 14-byte header with a
 * thumbnail of 0 × 0 — the RGB thumbnail pixels after it (a small copy of the
 * original picture, before any crop) are dropped.
 */
function jfifSegment(payload: Buffer): Buffer {
  const segment = Buffer.alloc(4 + JFIF_HEADER_LENGTH);
  segment[0] = 0xff;
  segment[1] = APP0;
  segment.writeUInt16BE(2 + JFIF_HEADER_LENGTH, 2);
  payload.copy(segment, 4, 0, JFIF_HEADER_LENGTH);
  segment[4 + 12] = 0; // Xthumbnail
  segment[4 + 13] = 0; // Ythumbnail
  return segment;
}

/** End of the entropy-coded data that starts at `from`: the offset of the next marker that is not a restart or a stuffed byte, or -1. */
function scanEnd(src: Buffer, from: number): number {
  let position = from;
  for (;;) {
    const ff = src.indexOf(0xff, position);
    if (ff === -1) return -1;
    let next = ff + 1;
    while (next < src.length && src[next] === 0xff) next += 1; // fill bytes
    if (next >= src.length) return -1;
    const code = src[next]!;
    if (code === 0x00 || (code >= 0xd0 && code <= 0xd7)) {
      position = next + 1; // stuffed 0xFF or a restart marker inside the scan
      continue;
    }
    return ff;
  }
}

/**
 * Walks a JPEG segment by segment (SOI, one supported frame, its tables, one
 * or more scans with their entropy-coded data, EOI) and rebuilds it without
 * the metadata segments. null = not a well-formed JPEG a browser decodes.
 */
export function cleanJpeg(bytes: Uint8Array): ParsedImage | null {
  const src = asBuffer(bytes);
  if (src.length < 4 || src[0] !== 0xff || src[1] !== SOI) return null;
  const out: Buffer[] = [src.subarray(0, 2)];
  /** Where a kept orientation goes: after SOI and the leading APP0 (JFIF) segments. */
  let exifAt = 1;
  let frame: { width: number; height: number } | null = null;
  let sawScan = false;
  let orientation: number | null = null;
  let sawJfif = false;
  let offset = 2;

  for (;;) {
    if (offset >= src.length || src[offset] !== 0xff) return null; // truncated, or garbage where a marker belongs
    while (offset < src.length && src[offset] === 0xff) offset += 1; // fill bytes before a marker
    if (offset >= src.length) return null;
    const marker = src[offset]!;
    offset += 1;
    if (marker === EOI) {
      if (frame === null || !sawScan) return null;
      out.push(Buffer.from([0xff, EOI]));
      break; // anything after EOI is dropped
    }
    // A stuffed byte, a restart, a second SOI or TEM outside a scan: not a well-formed stream.
    if (marker === 0x00 || marker === 0x01 || marker === SOI || (marker >= 0xd0 && marker <= 0xd7)) return null;
    if (offset + 2 > src.length) return null;
    const length = src.readUInt16BE(offset);
    if (length < 2 || offset + length > src.length) return null;
    const payload = src.subarray(offset + 2, offset + length);
    // The segment with one 0xFF before its marker (fill bytes are not copied).
    const segment = Buffer.concat([Buffer.from([0xff, marker]), src.subarray(offset, offset + length)]);
    offset += length;

    if (SUPPORTED_FRAMES.has(marker)) {
      if (frame !== null) return null;
      if (payload.length < 6) return null;
      const precision = payload[0]!;
      const height = payload.readUInt16BE(1);
      const width = payload.readUInt16BE(3);
      const components = payload[5]!;
      if (precision !== 8) return null; // browsers decode 8-bit samples only
      if (width === 0 || height === 0 || ![1, 3, 4].includes(components) || payload.length !== 6 + 3 * components) return null;
      frame = { width, height };
      out.push(segment);
    } else if (OTHER_FRAMES.has(marker) || marker === 0xdc /* DNL */) {
      return null;
    } else if (TABLE_SEGMENTS.has(marker)) {
      out.push(segment);
    } else if (marker === SOS) {
      if (frame === null) return null;
      const count = payload[0] ?? 0;
      if (count < 1 || count > 4 || payload.length !== 1 + 2 * count + 3) return null;
      out.push(segment);
      const end = scanEnd(src, offset);
      if (end === -1) return null; // the scan never ends: truncated
      out.push(src.subarray(offset, end));
      offset = end;
      sawScan = true;
    } else if (marker === APP0) {
      // The first JFIF header only, without its thumbnail; JFXX (a thumbnail extension) and any other APP0 are dropped.
      if (!sawJfif && startsWith(payload, JFIF_IDENTIFIER) && payload.length >= JFIF_HEADER_LENGTH) {
        sawJfif = true;
        if (out.length === exifAt) exifAt += 1;
        out.push(jfifSegment(payload));
      }
    } else if (marker === APP1) {
      // EXIF or XMP: dropped; the first EXIF block lends its orientation.
      if (orientation === null && startsWith(payload, EXIF_IDENTIFIER)) orientation = readExifOrientation(payload.subarray(EXIF_IDENTIFIER.length));
    } else if (marker === APP2) {
      if (startsWith(payload, ICC_IDENTIFIER)) out.push(segment); // the colour profile; FlashPix and the MPF index are dropped
    } else if (marker === APP14) {
      out.push(segment); // Adobe: the colour transform a decoder needs
    } else if ((marker >= 0xe3 && marker <= 0xef) || marker === 0xfe) {
      // Other APPn (APP13 = IPTC/Photoshop, vendor blocks) and COM: dropped.
    } else {
      return null; // JPGn, reserved markers
    }
  }
  if (frame === null) return null;
  if (keepsOrientation(orientation)) out.splice(exifAt, 0, exifSegment(orientation));
  return { width: frame.width, height: frame.height, orientation: keepsOrientation(orientation) ? orientation : null, bytes: Buffer.concat(out) };
}

// ---------------------------------------------------------------------------
// WebP
// ---------------------------------------------------------------------------

const VP8X_ICC = 0x20;
const VP8X_ALPHA = 0x10;
const VP8X_EXIF = 0x08;
const VP8X_XMP = 0x04;
const VP8X_ANIMATION = 0x02;
const VP8X_KNOWN = VP8X_ICC | VP8X_ALPHA | VP8X_EXIF | VP8X_XMP | VP8X_ANIMATION;
/** Chunks of an extended WebP that make up the picture — kept; EXIF, XMP and unknown chunks are dropped. */
const WEBP_KEPT = new Set(['ICCP', 'ANIM', 'ANMF', 'ALPH', 'VP8 ', 'VP8L']);

interface RiffChunk {
  fourcc: string;
  payload: Buffer;
}

/** Width and height of a VP8 (lossy) key frame, or null. */
export function vp8Dimensions(payload: Buffer): { width: number; height: number } | null {
  if (payload.length < 10) return null;
  const tag = payload[0]! | (payload[1]! << 8) | (payload[2]! << 16);
  const keyFrame = (tag & 1) === 0;
  const version = (tag >> 1) & 7;
  const firstPartition = tag >> 5;
  if (!keyFrame || version > 3 || firstPartition > payload.length - 10) return null;
  if (payload[3] !== 0x9d || payload[4] !== 0x01 || payload[5] !== 0x2a) return null;
  const width = payload.readUInt16LE(6) & 0x3fff;
  const height = payload.readUInt16LE(8) & 0x3fff;
  return width === 0 || height === 0 ? null : { width, height };
}

/** Width and height of a VP8L (lossless) bitstream, or null. */
export function vp8lDimensions(payload: Buffer): { width: number; height: number } | null {
  if (payload.length < 5 || payload[0] !== 0x2f) return null;
  const bits = payload.readUInt32LE(1);
  if (bits >>> 29 !== 0) return null; // version 0 only
  return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
}

function riffChunk(fourcc: string, payload: Buffer): Buffer {
  const padded = payload.length + (payload.length & 1);
  const chunk = Buffer.alloc(8 + padded);
  chunk.write(fourcc, 0, 'latin1');
  chunk.writeUInt32LE(payload.length, 4);
  payload.copy(chunk, 8);
  return chunk;
}

/**
 * Parses a WebP (RIFF size, chunk sizes, the simple VP8/VP8L forms or VP8X
 * with its still or animated picture) and rebuilds it without EXIF, XMP and
 * unknown chunks. null = not a well-formed WebP.
 */
export function cleanWebp(bytes: Uint8Array): ParsedImage | null {
  const src = asBuffer(bytes);
  if (src.length < 20 || src.toString('latin1', 0, 4) !== 'RIFF' || src.toString('latin1', 8, 12) !== 'WEBP') return null;
  const end = 8 + src.readUInt32LE(4);
  if (end > src.length || end < 20) return null; // truncated (bytes after the RIFF end are dropped)
  const chunks: RiffChunk[] = [];
  let offset = 12;
  while (offset < end) {
    if (offset + 8 > end) return null;
    const fourcc = src.toString('latin1', offset, offset + 4);
    const size = src.readUInt32LE(offset + 4);
    if (offset + 8 + size > end) return null;
    chunks.push({ fourcc, payload: src.subarray(offset + 8, offset + 8 + size) });
    offset += 8 + size + (size & 1); // a missing pad byte after the last chunk is tolerated
  }
  const first = chunks[0];
  if (!first) return null;

  if (first.fourcc === 'VP8 ' || first.fourcc === 'VP8L') {
    // The simple formats: the one bitstream chunk is the picture; anything after it is dropped.
    const size = first.fourcc === 'VP8 ' ? vp8Dimensions(first.payload) : vp8lDimensions(first.payload);
    if (size === null) return null;
    return { ...size, orientation: null, bytes: riffFile([riffChunk(first.fourcc, first.payload)]) };
  }
  if (first.fourcc !== 'VP8X' || first.payload.length !== 10) return null;

  const flags = first.payload[0]!;
  if ((flags & ~VP8X_KNOWN) !== 0) return null; // a reserved bit set: decoders refuse it
  const width = first.payload.readUIntLE(4, 3) + 1;
  const height = first.payload.readUIntLE(7, 3) + 1;
  const animated = (flags & VP8X_ANIMATION) !== 0;
  const rest = chunks.slice(1).filter((chunk) => WEBP_KEPT.has(chunk.fourcc));
  if (animated) {
    if (!rest.some((chunk) => chunk.fourcc === 'ANIM') || !rest.some((chunk) => chunk.fourcc === 'ANMF' && chunk.payload.length >= 16)) return null;
  } else {
    const images = rest.filter((chunk) => chunk.fourcc === 'VP8 ' || chunk.fourcc === 'VP8L');
    if (images.length !== 1 || rest.some((chunk) => chunk.fourcc === 'ANIM' || chunk.fourcc === 'ANMF')) return null;
    const image = images[0]!;
    const size = image.fourcc === 'VP8 ' ? vp8Dimensions(image.payload) : vp8lDimensions(image.payload);
    // A still picture fills the canvas exactly; an alpha plane only goes with a lossy one.
    if (size === null || size.width !== width || size.height !== height) return null;
    if (rest.some((chunk) => chunk.fourcc === 'ALPH') && image.fourcc !== 'VP8 ') return null;
  }
  const header = Buffer.from(first.payload);
  header[0] = flags & ~(VP8X_EXIF | VP8X_XMP);
  return { width, height, orientation: null, bytes: riffFile([riffChunk('VP8X', header), ...rest.map((chunk) => riffChunk(chunk.fourcc, chunk.payload))]) };
}

function riffFile(chunks: Buffer[]): Buffer {
  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(12);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(4 + body.length, 4);
  head.write('WEBP', 8, 'latin1');
  return Buffer.concat([head, body]);
}

/** Bits of VP8X kept as they are (exported for the tests). */
export const VP8X_FLAGS = { icc: VP8X_ICC, alpha: VP8X_ALPHA, exif: VP8X_EXIF, xmp: VP8X_XMP, animation: VP8X_ANIMATION } as const;
