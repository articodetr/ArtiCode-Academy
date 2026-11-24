// Homepage images — the pure byte rules (homepage-images.media.ts): detection
// from the bytes, the structural parse of PNG/JPEG/WebP, the dimensions and
// the metadata stripping. The fixtures are built in code: the PNG ones carry a
// real deflated IDAT (a browser decodes them); the JPEG and WebP ones are
// structurally valid streams with placeholder entropy data.
import { Buffer } from 'node:buffer';
import { crc32, deflateSync, inflateSync } from 'node:zlib';
import {
  IMAGE_LIMITS,
  VP8X_FLAGS,
  cleanJpeg,
  cleanPng,
  cleanWebp,
  dimensionsAllowed,
  imageContentTypeOf,
  inspectImage,
  orientationTiff,
  readExifOrientation,
  sniffImageType,
} from './homepage-images.media.js';

// --- PNG -------------------------------------------------------------------

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngChunk(type: string, data: Buffer = Buffer.alloc(0)): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function ihdr(width: number, height: number, bitDepth = 8, colorType = 6): Buffer {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data[8] = bitDepth;
  data[9] = colorType;
  return pngChunk('IHDR', data);
}

/** Real RGBA pixel rows (filter 0): half-transparent red. */
function rgbaRows(width: number, height: number): Buffer {
  const row = Buffer.alloc(1 + width * 4);
  for (let x = 0; x < width; x += 1) {
    row[1 + x * 4] = 255;
    row[4 + x * 4] = 128;
  }
  return Buffer.concat(Array.from({ length: height }, () => row));
}

function png(options: { width?: number; height?: number; before?: Buffer[]; after?: Buffer[]; trailing?: Buffer } = {}): Buffer {
  const width = options.width ?? 64;
  const height = options.height ?? 64;
  return Buffer.concat([
    PNG_SIGNATURE,
    ihdr(width, height),
    ...(options.before ?? []),
    pngChunk('IDAT', deflateSync(rgbaRows(width, height))),
    ...(options.after ?? []),
    pngChunk('IEND'),
    options.trailing ?? Buffer.alloc(0),
  ]);
}

/** The chunk types of a PNG, in order. */
function pngTypes(bytes: Buffer): string[] {
  const types: string[] = [];
  let offset = 8;
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    types.push(bytes.toString('latin1', offset + 4, offset + 8));
    offset += 12 + length;
  }
  return types;
}

function pngData(bytes: Buffer, type: string): Buffer[] {
  const found: Buffer[] = [];
  let offset = 8;
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    if (bytes.toString('latin1', offset + 4, offset + 8) === type) found.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  return found;
}

// --- EXIF ------------------------------------------------------------------

/** A TIFF stream with Orientation and a GPS IFD pointer — and a recognisable GPS payload. */
function tiffWithGps(orientation: number, littleEndian = true): Buffer {
  const tiff = Buffer.alloc(8 + 2 + 2 * 12 + 4 + 32);
  const u16 = (value: number, offset: number) => (littleEndian ? tiff.writeUInt16LE(value, offset) : tiff.writeUInt16BE(value, offset));
  const u32 = (value: number, offset: number) => (littleEndian ? tiff.writeUInt32LE(value, offset) : tiff.writeUInt32BE(value, offset));
  tiff.write(littleEndian ? 'II' : 'MM', 0, 'latin1');
  u16(42, 2);
  u32(8, 4);
  u16(2, 8);
  // GPSInfo IFD pointer (0x8825, LONG) first, then Orientation.
  u16(0x8825, 10);
  u16(4, 12);
  u32(1, 14);
  u32(38, 18);
  u16(0x0112, 22);
  u16(3, 24);
  u32(1, 26);
  u16(orientation, 30);
  u32(0, 34);
  tiff.write('GPS-LAT-24.7136-LON-46.6753', 38, 'latin1');
  return tiff;
}

// --- JPEG ------------------------------------------------------------------

function segment(marker: number, payload: Buffer): Buffer {
  const out = Buffer.alloc(4 + payload.length);
  out[0] = 0xff;
  out[1] = marker;
  out.writeUInt16BE(payload.length + 2, 2);
  payload.copy(out, 4);
  return out;
}

const JFIF = segment(0xe0, Buffer.from([0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]));
/** Entropy-coded bytes with a stuffed 0xFF00 and a restart marker inside. */
const SCAN = Buffer.from([0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd0, 0x78, 0x9a]);

function sof(width: number, height: number, marker = 0xc0, precision = 8): Buffer {
  const payload = Buffer.alloc(6 + 9);
  payload[0] = precision;
  payload.writeUInt16BE(height, 1);
  payload.writeUInt16BE(width, 3);
  payload[5] = 3;
  for (let component = 0; component < 3; component += 1) {
    payload[6 + component * 3] = component + 1;
    payload[7 + component * 3] = component === 0 ? 0x22 : 0x11;
    payload[8 + component * 3] = component === 0 ? 0 : 1;
  }
  return segment(marker, payload);
}

function jpeg(options: { width?: number; height?: number; before?: Buffer[]; frame?: Buffer; trailing?: Buffer; end?: boolean } = {}): Buffer {
  const dqt = segment(0xdb, Buffer.concat([Buffer.from([0x00]), Buffer.alloc(64, 1)]));
  const dht = segment(0xc4, Buffer.concat([Buffer.from([0x00]), Buffer.from([0, 1, ...Array<number>(14).fill(0)]), Buffer.from([0])]));
  const sos = segment(0xda, Buffer.from([3, 1, 0x00, 2, 0x11, 3, 0x11, 0, 63, 0]));
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    JFIF,
    ...(options.before ?? []),
    dqt,
    options.frame ?? sof(options.width ?? 64, options.height ?? 48),
    dht,
    sos,
    SCAN,
    options.end === false ? Buffer.alloc(0) : Buffer.from([0xff, 0xd9]),
    options.trailing ?? Buffer.alloc(0),
  ]);
}

/** The markers of a JPEG, in order (the scan data is skipped). */
function jpegMarkers(bytes: Buffer): number[] {
  const markers: number[] = [];
  let offset = 2;
  while (offset < bytes.length) {
    const marker = bytes[offset + 1]!;
    markers.push(marker);
    if (marker === 0xd9) break;
    const length = bytes.readUInt16BE(offset + 2);
    offset += 2 + length;
    if (marker === 0xda) {
      // skip the entropy-coded data up to the next real marker
      while (!(bytes[offset] === 0xff && bytes[offset + 1] !== 0x00 && !(bytes[offset + 1]! >= 0xd0 && bytes[offset + 1]! <= 0xd7))) offset += 1;
    }
  }
  return markers;
}

// --- WebP ------------------------------------------------------------------

function riffChunk(fourcc: string, payload: Buffer): Buffer {
  const pad = payload.length & 1;
  const out = Buffer.alloc(8 + payload.length + pad);
  out.write(fourcc, 0, 'latin1');
  out.writeUInt32LE(payload.length, 4);
  payload.copy(out, 8);
  return out;
}

function riff(chunks: Buffer[], trailing: Buffer = Buffer.alloc(0)): Buffer {
  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(12);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(4 + body.length, 4);
  head.write('WEBP', 8, 'latin1');
  return Buffer.concat([head, body, trailing]);
}

function vp8l(width: number, height: number, alpha = true): Buffer {
  const payload = Buffer.alloc(13, 0x55);
  payload[0] = 0x2f;
  payload.writeUInt32LE(((width - 1) | ((height - 1) << 14) | ((alpha ? 1 : 0) << 28)) >>> 0, 1);
  return riffChunk('VP8L', payload);
}

function vp8(width: number, height: number, keyFrame = true): Buffer {
  const partition = 4;
  const payload = Buffer.alloc(10 + partition + 3, 0x33);
  const tag = (keyFrame ? 0 : 1) | (1 << 4) | (partition << 5);
  payload[0] = tag & 0xff;
  payload[1] = (tag >> 8) & 0xff;
  payload[2] = (tag >> 16) & 0xff;
  payload[3] = 0x9d;
  payload[4] = 0x01;
  payload[5] = 0x2a;
  payload.writeUInt16LE(width, 6);
  payload.writeUInt16LE(height, 8);
  return riffChunk('VP8 ', payload);
}

function vp8x(flags: number, width: number, height: number): Buffer {
  const payload = Buffer.alloc(10);
  payload[0] = flags;
  payload.writeUIntLE(width - 1, 4, 3);
  payload.writeUIntLE(height - 1, 7, 3);
  return riffChunk('VP8X', payload);
}

function webpFourccs(bytes: Buffer): string[] {
  const found: string[] = [];
  let offset = 12;
  while (offset < bytes.length) {
    const size = bytes.readUInt32LE(offset + 4);
    found.push(bytes.toString('latin1', offset, offset + 4));
    offset += 8 + size + (size & 1);
  }
  return found;
}

const XMP = Buffer.from('<x:xmpmeta><rdf:Description exif:GPSLatitude="24,42.8N"/></x:xmpmeta>', 'latin1');

// ---------------------------------------------------------------------------

describe('homepage images — content types and limits', () => {
  it('reads the media type of the Content-Type header (parameters and case ignored), only the three image types', () => {
    expect(imageContentTypeOf('image/png')).toBe('image/png');
    expect(imageContentTypeOf('IMAGE/JPEG; charset=binary')).toBe('image/jpeg');
    expect(imageContentTypeOf(' image/webp ')).toBe('image/webp');
    for (const other of ['image/svg+xml', 'image/gif', 'image/jpg', 'application/json', 'application/octet-stream', 'text/html', '', undefined]) {
      expect(imageContentTypeOf(other), String(other)).toBeNull();
    }
    expect(imageContentTypeOf(['image/png'])).toBeNull();
  });

  it('allows each side 64..8000 px and at most 40 million pixels', () => {
    expect(IMAGE_LIMITS).toEqual({ minSide: 64, maxSide: 8000, maxPixels: 40_000_000 });
    expect(dimensionsAllowed(64, 64)).toBe(true);
    expect(dimensionsAllowed(8000, 5000)).toBe(true); // exactly 40 million
    expect(dimensionsAllowed(63, 64)).toBe(false);
    expect(dimensionsAllowed(64, 63)).toBe(false);
    expect(dimensionsAllowed(8001, 100)).toBe(false);
    expect(dimensionsAllowed(100, 8001)).toBe(false);
    expect(dimensionsAllowed(8000, 5001)).toBe(false);
  });
});

describe('homepage images — detection from the bytes', () => {
  it('recognises PNG, JPEG and WebP by their magic numbers', () => {
    expect(sniffImageType(png())).toBe('image/png');
    expect(sniffImageType(jpeg())).toBe('image/jpeg');
    expect(sniffImageType(riff([vp8l(64, 64)]))).toBe('image/webp');
  });

  it('recognises nothing else: SVG, GIF, HTML, an executable, a ZIP, plain text, an empty body, a RIFF that is not WebP', () => {
    const others = [
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
      Buffer.from('<?xml version="1.0"?><svg/>'),
      Buffer.from('GIF89a\x40\x00\x40\x00', 'latin1'),
      Buffer.from('<!doctype html><html><body>hi</body></html>'),
      Buffer.from('MZ\x90\x00\x03\x00', 'latin1'),
      Buffer.from('\x7fELF\x02\x01\x01', 'latin1'),
      Buffer.from('PK\x03\x04', 'latin1'),
      Buffer.from('just text'),
      Buffer.alloc(0),
      Buffer.from('RIFF\x10\x00\x00\x00WAVEfmt ', 'latin1'),
      PNG_SIGNATURE.subarray(0, 7),
    ];
    for (const bytes of others) {
      expect(sniffImageType(bytes), bytes.toString('latin1')).toBeNull();
      expect(inspectImage(bytes, 'image/png')).toEqual({ ok: false, reason: 'unrecognized' });
    }
  });

  it('refuses a picture whose bytes are another type than the declared one (type_mismatch), before any parse', () => {
    expect(inspectImage(png(), 'image/jpeg')).toEqual({ ok: false, reason: 'type_mismatch' });
    expect(inspectImage(jpeg(), 'image/webp')).toEqual({ ok: false, reason: 'type_mismatch' });
    expect(inspectImage(riff([vp8l(64, 64)]), 'image/png')).toEqual({ ok: false, reason: 'type_mismatch' });
  });

  it('answers the type, the extension, the size and the cleaned bytes of a well-formed picture', () => {
    const result = inspectImage(png({ width: 96, height: 70 }), 'image/png');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.image).toMatchObject({ contentType: 'image/png', extension: 'png', width: 96, height: 70 });
    expect(inspectImage(jpeg({ width: 120, height: 90 }), 'image/jpeg')).toMatchObject({ ok: true, image: { contentType: 'image/jpeg', extension: 'jpg', width: 120, height: 90 } });
    expect(inspectImage(riff([vp8l(200, 100)]), 'image/webp')).toMatchObject({ ok: true, image: { contentType: 'image/webp', extension: 'webp', width: 200, height: 100 } });
  });
});

describe('homepage images — PNG', () => {
  it('parses a real PNG: its size, and the pixel data is copied byte for byte (it still inflates to the same rows)', () => {
    const source = png({ width: 80, height: 65 });
    const parsed = cleanPng(source);
    expect(parsed).toMatchObject({ width: 80, height: 65, orientation: null });
    expect(parsed!.bytes.equals(source)).toBe(true); // nothing to strip
    expect(inflateSync(Buffer.concat(pngData(parsed!.bytes, 'IDAT'))).equals(rgbaRows(80, 65))).toBe(true);
  });

  it('drops tEXt, zTXt, iTXt, eXIf, tIME and unknown ancillary chunks; keeps transparency, colour and size chunks; drops bytes after IEND', () => {
    const before = [
      pngChunk('gAMA', Buffer.from([0, 0, 0xb1, 0x8f])),
      pngChunk('iCCP', Buffer.concat([Buffer.from('icc\0\0', 'latin1'), deflateSync(Buffer.from('profile'))])),
      pngChunk('pHYs', Buffer.from([0, 0, 0x0b, 0x13, 0, 0, 0x0b, 0x13, 1])),
      pngChunk('tEXt', Buffer.from('Author\0Somebody at 24.71N 46.67E', 'latin1')),
      pngChunk('zTXt', Buffer.concat([Buffer.from('Comment\0\0', 'latin1'), deflateSync(Buffer.from('hidden'))])),
      pngChunk('iTXt', Buffer.from('XML:com.adobe.xmp\0\0\0\0\0<x:xmpmeta>GPS</x:xmpmeta>', 'latin1')),
      pngChunk('eXIf', tiffWithGps(1)),
      pngChunk('tIME', Buffer.from([0x07, 0xea, 11, 24, 10, 0, 0])),
      pngChunk('prVt', Buffer.from('private camera data')),
    ];
    const source = png({ before, after: [pngChunk('tEXt', Buffer.from('Late\0text', 'latin1'))], trailing: Buffer.from('<html>appended</html>') });
    const parsed = cleanPng(source)!;
    expect(parsed).not.toBeNull();
    expect(pngTypes(parsed.bytes)).toEqual(['IHDR', 'gAMA', 'iCCP', 'pHYs', 'IDAT', 'IEND']);
    const text = parsed.bytes.toString('latin1');
    for (const leaked of ['Somebody', 'hidden', 'xmpmeta', 'GPS', 'private camera', 'Late', 'appended']) expect(text).not.toContain(leaked);
    // The result is itself a well-formed PNG with the same pixels.
    expect(cleanPng(parsed.bytes)).toMatchObject({ width: 64, height: 64 });
    expect(inflateSync(Buffer.concat(pngData(parsed.bytes, 'IDAT'))).equals(rgbaRows(64, 64))).toBe(true);
  });

  it('keeps tRNS, the palette and the APNG chunks', () => {
    const palette = Buffer.concat([
      PNG_SIGNATURE,
      ihdr(64, 64, 8, 3),
      pngChunk('PLTE', Buffer.from([255, 0, 0, 0, 0, 255])),
      pngChunk('tRNS', Buffer.from([128])),
      pngChunk('IDAT', deflateSync(Buffer.alloc(64 * 65))),
      pngChunk('IEND'),
    ]);
    expect(pngTypes(cleanPng(palette)!.bytes)).toEqual(['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND']);
    const animated = png({ before: [pngChunk('acTL', Buffer.alloc(8)), pngChunk('fcTL', Buffer.alloc(26))], after: [pngChunk('fcTL', Buffer.alloc(26)), pngChunk('fdAT', Buffer.alloc(8))] });
    expect(pngTypes(cleanPng(animated)!.bytes)).toEqual(['IHDR', 'acTL', 'fcTL', 'IDAT', 'fcTL', 'fdAT', 'IEND']);
  });

  it('keeps the EXIF orientation alone as a minimal eXIf after IHDR, and a turned picture reports its shown size', () => {
    const source = png({ width: 100, height: 70, before: [pngChunk('eXIf', tiffWithGps(6))] });
    const parsed = cleanPng(source)!;
    expect(parsed.orientation).toBe(6);
    expect(pngTypes(parsed.bytes)).toEqual(['IHDR', 'eXIf', 'IDAT', 'IEND']);
    const exif = pngData(parsed.bytes, 'eXIf')[0]!;
    expect(exif.equals(orientationTiff(6))).toBe(true);
    expect(exif.toString('latin1')).not.toContain('GPS');
    expect(inspectImage(source, 'image/png')).toMatchObject({ ok: true, image: { width: 70, height: 100 } });
    // Orientation 1 (as stored) needs nothing.
    expect(pngTypes(cleanPng(png({ before: [pngChunk('eXIf', tiffWithGps(1))] }))!.bytes)).toEqual(['IHDR', 'IDAT', 'IEND']);
  });

  it('refuses a truncated, forged or malformed PNG (corrupt)', () => {
    const good = png();
    const badCrc = Buffer.from(good);
    badCrc[good.length - 30] ^= 0xff; // inside the IDAT data
    const noIend = good.subarray(0, good.length - 12);
    const truncated = good.subarray(0, good.length - 20);
    const noIdat = Buffer.concat([PNG_SIGNATURE, ihdr(64, 64), pngChunk('IEND')]);
    const notIhdrFirst = Buffer.concat([PNG_SIGNATURE, pngChunk('gAMA', Buffer.alloc(4)), ihdr(64, 64), pngChunk('IDAT', deflateSync(rgbaRows(64, 64))), pngChunk('IEND')]);
    const badDepth = Buffer.concat([PNG_SIGNATURE, ihdr(64, 64, 4, 6), pngChunk('IDAT', deflateSync(rgbaRows(64, 64))), pngChunk('IEND')]);
    const zeroWidth = Buffer.concat([PNG_SIGNATURE, ihdr(0, 64), pngChunk('IDAT', deflateSync(Buffer.alloc(64))), pngChunk('IEND')]);
    const paletteMissing = Buffer.concat([PNG_SIGNATURE, ihdr(64, 64, 8, 3), pngChunk('IDAT', deflateSync(Buffer.alloc(64 * 65))), pngChunk('IEND')]);
    const unknownCritical = png({ before: [pngChunk('ABCD', Buffer.alloc(3))] });
    const twoHeaders = png({ before: [ihdr(64, 64)] });
    const fakeHeader = Buffer.concat([PNG_SIGNATURE, Buffer.from('<script>alert(1)</script>')]);
    const badType = png({ before: [pngChunk('t3Xt', Buffer.alloc(2))] });
    for (const [name, bytes] of Object.entries({ badCrc, noIend, truncated, noIdat, notIhdrFirst, badDepth, zeroWidth, paletteMissing, unknownCritical, twoHeaders, fakeHeader, badType })) {
      expect(cleanPng(bytes), name).toBeNull();
      expect(inspectImage(bytes, 'image/png'), name).toEqual({ ok: false, reason: 'corrupt' });
    }
  });

  it('reads the size from IHDR without inflating the data, so a huge declared canvas is answered by the dimension rule', () => {
    const huge = Buffer.concat([PNG_SIGNATURE, ihdr(8000, 5001), pngChunk('IDAT', deflateSync(Buffer.alloc(16))), pngChunk('IEND')]);
    const result = inspectImage(huge, 'image/png');
    expect(result).toMatchObject({ ok: true, image: { width: 8000, height: 5001 } });
    if (result.ok) expect(dimensionsAllowed(result.image.width, result.image.height)).toBe(false);
  });
});

describe('homepage images — JPEG', () => {
  it('parses a JPEG: the frame size, and the entropy-coded data (stuffed bytes and restarts included) copied byte for byte', () => {
    const source = jpeg({ width: 320, height: 200 });
    const parsed = cleanJpeg(source);
    expect(parsed).toMatchObject({ width: 320, height: 200, orientation: null });
    expect(parsed!.bytes.equals(source)).toBe(true);
    expect(parsed!.bytes.includes(SCAN)).toBe(true);
    expect(cleanJpeg(jpeg({ frame: sof(64, 64, 0xc2) }))).toMatchObject({ width: 64, height: 64 }); // progressive
  });

  it('drops APP1 (EXIF, XMP), APP13 (IPTC), COM, vendor APPn and the MPF index; keeps JFIF, the ICC profile and Adobe APP14; drops bytes after EOI', () => {
    const before = [
      segment(0xe1, Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiffWithGps(1)])),
      segment(0xe1, Buffer.concat([Buffer.from('http://ns.adobe.com/xap/1.0/\0', 'latin1'), XMP])),
      segment(0xe2, Buffer.concat([Buffer.from('ICC_PROFILE\0', 'latin1'), Buffer.from([1, 1]), Buffer.from('colour profile')])),
      segment(0xe2, Buffer.concat([Buffer.from('MPF\0', 'latin1'), Buffer.from('MM\0*second picture index')])),
      segment(0xed, Buffer.from('Photoshop 3.0\x008BIM IPTC byline: Somebody', 'latin1')),
      segment(0xe5, Buffer.from('vendor maker notes')),
      segment(0xee, Buffer.from('Adobe\0\x64\0\0\0\0\x01', 'latin1')),
      segment(0xfe, Buffer.from('a comment with a secret')),
    ];
    const source = jpeg({ before, trailing: Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.from('second picture with EXIF GPS')]) });
    const parsed = cleanJpeg(source)!;
    expect(parsed).not.toBeNull();
    expect(jpegMarkers(parsed.bytes)).toEqual([0xe0, 0xe2, 0xee, 0xdb, 0xc0, 0xc4, 0xda, 0xd9]);
    const text = parsed.bytes.toString('latin1');
    for (const leaked of ['Exif', 'GPS', 'xmpmeta', 'MPF', 'Somebody', 'vendor', 'secret', 'second picture']) expect(text).not.toContain(leaked);
    expect(text).toContain('colour profile');
    expect(parsed.bytes.subarray(-2).equals(Buffer.from([0xff, 0xd9]))).toBe(true);
    expect(cleanJpeg(parsed.bytes)).toMatchObject({ width: 64, height: 48 });
  });

  it('keeps the JFIF header without its thumbnail (0 × 0, length 16) and drops JFXX and any other APP0', () => {
    // JFIF 1.02 with a 2 × 2 RGB thumbnail (12 bytes of pixels) after the 14-byte header.
    const thumbnail = Buffer.from('THUMBNAILPIX', 'latin1');
    const jfifWithThumbnail = segment(
      0xe0,
      Buffer.concat([Buffer.from([0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x02, 0x01, 0x00, 0x48, 0x00, 0x48, 0x02, 0x02]), thumbnail]),
    );
    const jfxx = segment(0xe0, Buffer.concat([Buffer.from('JFXX\0\x10', 'latin1'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]), Buffer.from('JFXX-THUMB')]));
    const otherApp0 = segment(0xe0, Buffer.from('AVI1 vendor block'));
    const source = Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      jfifWithThumbnail,
      jfxx,
      otherApp0,
      segment(0xe0, Buffer.from([0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00])), // a second JFIF
      jpeg({ width: 100, height: 80 }).subarray(2 + JFIF.length),
    ]);
    const parsed = cleanJpeg(source)!;
    expect(parsed).toMatchObject({ width: 100, height: 80 });
    expect(jpegMarkers(parsed.bytes)).toEqual([0xe0, 0xdb, 0xc0, 0xc4, 0xda, 0xd9]);
    const app0 = parsed.bytes.subarray(2, 2 + 18);
    expect(app0.readUInt16BE(2)).toBe(16);
    expect(app0.toString('latin1', 4, 9)).toBe('JFIF\0');
    expect([...app0.subarray(9, 16)]).toEqual([0x01, 0x02, 0x01, 0x00, 0x48, 0x00, 0x48]); // version, units and densities kept
    expect([app0[16], app0[17]]).toEqual([0, 0]); // no thumbnail
    const text = parsed.bytes.toString('latin1');
    for (const leaked of ['THUMBNAILPIX', 'JFXX', 'AVI1']) expect(text).not.toContain(leaked);
    expect(cleanJpeg(parsed.bytes)).toMatchObject({ width: 100, height: 80 });
    // A stream whose only APP0 is JFXX keeps no APP0 at all.
    const onlyJfxx = Buffer.concat([Buffer.from([0xff, 0xd8]), jfxx, jpeg().subarray(2 + JFIF.length)]);
    expect(jpegMarkers(cleanJpeg(onlyJfxx)!.bytes)[0]).toBe(0xdb);
  });

  it('keeps the EXIF orientation alone (a 36-byte APP1 after JFIF) — little- and big-endian EXIF — and a turned picture reports its shown size', () => {
    for (const littleEndian of [true, false]) {
      const source = jpeg({ width: 400, height: 300, before: [segment(0xe1, Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiffWithGps(8, littleEndian)]))] });
      const parsed = cleanJpeg(source)!;
      expect(parsed.orientation).toBe(8);
      expect(jpegMarkers(parsed.bytes).slice(0, 2)).toEqual([0xe0, 0xe1]);
      const app1 = parsed.bytes.subarray(2 + JFIF.length, 2 + JFIF.length + 36);
      expect(app1.readUInt16BE(2)).toBe(34);
      expect(readExifOrientation(app1.subarray(10))).toBe(8);
      expect(parsed.bytes.toString('latin1')).not.toContain('GPS');
      expect(inspectImage(source, 'image/jpeg')).toMatchObject({ ok: true, image: { width: 300, height: 400 } });
    }
  });

  it('refuses a truncated, forged or undecodable JPEG (corrupt)', () => {
    const good = jpeg();
    const cases = {
      noEoi: jpeg({ end: false }),
      truncatedHeader: good.subarray(0, 30),
      noFrame: Buffer.concat([Buffer.from([0xff, 0xd8]), JFIF, segment(0xda, Buffer.from([1, 1, 0, 0, 63, 0])), SCAN, Buffer.from([0xff, 0xd9])]),
      noScan: Buffer.concat([Buffer.from([0xff, 0xd8]), JFIF, sof(64, 64), Buffer.from([0xff, 0xd9])]),
      lossless: jpeg({ frame: sof(64, 64, 0xc3) }),
      arithmetic: jpeg({ frame: sof(64, 64, 0xc9) }),
      twelveBit: jpeg({ frame: sof(64, 64, 0xc1, 12) }),
      zeroHeight: jpeg({ frame: sof(64, 0) }),
      twoFrames: jpeg({ before: [sof(64, 64)] }),
      badLength: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xff]), Buffer.alloc(10)]),
      garbageBetweenSegments: Buffer.concat([Buffer.from([0xff, 0xd8]), JFIF, Buffer.from('xx'), good.subarray(2 + JFIF.length)]),
      fakeHeader: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from('<html><script>alert(1)</script></html>')]),
    };
    for (const [name, bytes] of Object.entries(cases)) {
      expect(cleanJpeg(bytes), name).toBeNull();
      expect(inspectImage(bytes, 'image/jpeg'), name).toEqual({ ok: false, reason: 'corrupt' });
    }
  });
});

describe('homepage images — WebP', () => {
  it('parses the simple lossless and lossy forms', () => {
    expect(cleanWebp(riff([vp8l(300, 150)]))).toMatchObject({ width: 300, height: 150, orientation: null });
    expect(cleanWebp(riff([vp8(640, 480)]))).toMatchObject({ width: 640, height: 480 });
    const lossless = riff([vp8l(64, 64)]);
    expect(cleanWebp(lossless)!.bytes.equals(lossless)).toBe(true);
  });

  it('drops EXIF, XMP and unknown chunks of VP8X, clears their flags, keeps alpha and the ICC profile, and recomputes the RIFF size', () => {
    const flags = VP8X_FLAGS.icc | VP8X_FLAGS.alpha | VP8X_FLAGS.exif | VP8X_FLAGS.xmp;
    const alpha = riffChunk('ALPH', Buffer.from([0x00, 1, 2, 3, 4]));
    const source = riff(
      [
        vp8x(flags, 120, 80),
        riffChunk('ICCP', Buffer.from('colour profile')),
        alpha,
        vp8(120, 80),
        riffChunk('EXIF', tiffWithGps(1)),
        riffChunk('XMP ', XMP),
        riffChunk('JUNK', Buffer.from('vendor data')),
      ],
      Buffer.from('<html>appended</html>'),
    );
    const parsed = cleanWebp(source)!;
    expect(parsed).toMatchObject({ width: 120, height: 80 });
    expect(webpFourccs(parsed.bytes)).toEqual(['VP8X', 'ICCP', 'ALPH', 'VP8 ']);
    expect(parsed.bytes[20]).toBe(VP8X_FLAGS.icc | VP8X_FLAGS.alpha); // the flags byte of VP8X
    expect(parsed.bytes.readUInt32LE(4)).toBe(parsed.bytes.length - 8);
    const text = parsed.bytes.toString('latin1');
    for (const leaked of ['GPS', 'xmpmeta', 'vendor', 'appended']) expect(text).not.toContain(leaked);
    expect(parsed.bytes.includes(alpha)).toBe(true); // the alpha plane untouched
    expect(cleanWebp(parsed.bytes)).toMatchObject({ width: 120, height: 80 });
  });

  it('accepts a lossless VP8X with alpha and an animated one (ANIM + ANMF)', () => {
    expect(cleanWebp(riff([vp8x(VP8X_FLAGS.alpha, 64, 64), vp8l(64, 64)]))).toMatchObject({ width: 64, height: 64 });
    const animated = riff([vp8x(VP8X_FLAGS.animation, 100, 90), riffChunk('ANIM', Buffer.alloc(6)), riffChunk('ANMF', Buffer.alloc(16 + 8))]);
    expect(cleanWebp(animated)).toMatchObject({ width: 100, height: 90 });
  });

  it('refuses a truncated, forged or inconsistent WebP (corrupt)', () => {
    const good = riff([vp8l(64, 64)]);
    const cases = {
      truncated: good.subarray(0, good.length - 4),
      chunkPastEnd: (() => {
        const bytes = Buffer.from(good);
        bytes.writeUInt32LE(9999, 16);
        return bytes;
      })(),
      noChunks: riff([]),
      unknownFirst: riff([riffChunk('JUNK', Buffer.alloc(12))]),
      badLosslessSignature: riff([riffChunk('VP8L', Buffer.alloc(13))]),
      notKeyFrame: riff([vp8(64, 64, false)]),
      canvasMismatch: riff([vp8x(0, 64, 64), vp8l(65, 64)]),
      noImage: riff([vp8x(0, 64, 64)]),
      twoImages: riff([vp8x(0, 64, 64), vp8l(64, 64), vp8l(64, 64)]),
      reservedFlag: riff([vp8x(0x01, 64, 64), vp8l(64, 64)]),
      alphaWithLossless: riff([vp8x(VP8X_FLAGS.alpha, 64, 64), riffChunk('ALPH', Buffer.alloc(4)), vp8l(64, 64)]),
      animationWithoutFrames: riff([vp8x(VP8X_FLAGS.animation, 64, 64), riffChunk('ANIM', Buffer.alloc(6))]),
      shortVp8x: riff([riffChunk('VP8X', Buffer.alloc(6)), vp8l(64, 64)]),
    };
    for (const [name, bytes] of Object.entries(cases)) {
      expect(cleanWebp(bytes), name).toBeNull();
      expect(inspectImage(bytes, 'image/webp'), name).toEqual({ ok: false, reason: 'corrupt' });
    }
  });
});

describe('homepage images — EXIF orientation', () => {
  it('reads the Orientation tag of IFD0 in both byte orders, and nothing from a malformed stream', () => {
    expect(readExifOrientation(tiffWithGps(6, true))).toBe(6);
    expect(readExifOrientation(tiffWithGps(3, false))).toBe(3);
    expect(readExifOrientation(orientationTiff(5))).toBe(5);
    expect(readExifOrientation(tiffWithGps(9))).toBeNull(); // out of range
    expect(readExifOrientation(Buffer.from('II*\0', 'latin1'))).toBeNull();
    expect(readExifOrientation(Buffer.from('XX*\0\x08\0\0\0', 'latin1'))).toBeNull();
    const noTag = Buffer.from(orientationTiff(6));
    noTag.writeUInt16LE(0x0110, 10); // another tag
    expect(readExifOrientation(noTag)).toBeNull();
    const pastEnd = Buffer.from(orientationTiff(6));
    pastEnd.writeUInt32LE(4000, 4);
    expect(readExifOrientation(pastEnd)).toBeNull();
  });
});
