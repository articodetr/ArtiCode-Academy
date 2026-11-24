import { describe, expect, it } from 'vitest'
import { HOME_IMAGE_SLOTS } from '../publicHome/homeImageSlots'
import {
  cornersOpaque,
  detectPictureType,
  dimensionsText,
  fileSizeParts,
  inspectPicture,
  isolateLtr,
  pictureTypeLabel,
  pictureWarnings,
  publishedSrc,
  readExifOrientation,
  shapeDiffers,
  sizeRefusal,
  withOpaqueCorners,
} from './homepageImages.rules'
import type { PictureInfo } from './homepageImages.rules'
import { EXE_BYTES, exifTiff, GIF_BYTES, jpegBytes, PDF_BYTES, pngBytes, SVG_BYTES, webpBytes } from './homepageImages.testData'

const text = (value: string) => new Uint8Array([...value].map((char) => char.charCodeAt(0)))

describe('detectPictureType — the type from the first bytes, never from the name', () => {
  it('recognises a PNG by its signature, a JPEG by its SOI and a WebP by RIFF....WEBP', () => {
    expect(detectPictureType(pngBytes())).toBe('image/png')
    expect(detectPictureType(jpegBytes())).toBe('image/jpeg')
    expect(detectPictureType(webpBytes({ kind: 'VP8 ' }))).toBe('image/webp')
    expect(detectPictureType(webpBytes({ kind: 'VP8L' }))).toBe('image/webp')
    expect(detectPictureType(webpBytes({ kind: 'VP8X' }))).toBe('image/webp')
  })

  it('refuses an SVG, a GIF, a PDF, a program, another RIFF file, a cut signature and nothing at all', () => {
    expect(detectPictureType(SVG_BYTES)).toBeNull()
    expect(detectPictureType(GIF_BYTES)).toBeNull()
    expect(detectPictureType(PDF_BYTES)).toBeNull()
    expect(detectPictureType(EXE_BYTES)).toBeNull()
    expect(detectPictureType(text('RIFF\u0000\u0000\u0000\u0000WAVEfmt '))).toBeNull()
    expect(detectPictureType(pngBytes().subarray(0, 6))).toBeNull()
    expect(detectPictureType(new Uint8Array([0xff, 0xd8]))).toBeNull()
    expect(detectPictureType(new Uint8Array())).toBeNull()
  })
})

describe('inspectPicture — the size from the headers, and why a file is refused', () => {
  it('reads the size and the transparency of a PNG (alpha channel or tRNS)', () => {
    expect(inspectPicture(pngBytes({ width: 1520, height: 1962 }))).toEqual({ info: { contentType: 'image/png', width: 1520, height: 1962, alpha: true } })
    expect(inspectPicture(pngBytes({ colourType: 4 }))).toMatchObject({ info: { alpha: true } })
    expect(inspectPicture(pngBytes({ colourType: 2 }))).toMatchObject({ info: { alpha: false } })
    expect(inspectPicture(pngBytes({ colourType: 3, tRNS: true }))).toMatchObject({ info: { alpha: true } })
    expect(inspectPicture(pngBytes({ colourType: 3 }))).toMatchObject({ info: { alpha: false } })
  })

  it('reads the size of a JPEG from its frame header, after an EXIF segment and for a progressive one', () => {
    expect(inspectPicture(jpegBytes({ width: 1920, height: 1080 }))).toEqual({ info: { contentType: 'image/jpeg', width: 1920, height: 1080, alpha: false } })
    expect(inspectPicture(jpegBytes({ width: 1000, height: 700, exif: true }))).toMatchObject({ info: { width: 1000, height: 700 } })
    expect(inspectPicture(jpegBytes({ width: 800, height: 760, progressive: true }))).toMatchObject({ info: { width: 800, height: 760 } })
  })

  it('reads the size and the alpha of the three WebP kinds', () => {
    expect(inspectPicture(webpBytes({ kind: 'VP8 ', width: 900, height: 560 }))).toEqual({ info: { contentType: 'image/webp', width: 900, height: 560, alpha: false } })
    expect(inspectPicture(webpBytes({ kind: 'VP8L', width: 760, height: 981, alpha: true }))).toEqual({ info: { contentType: 'image/webp', width: 760, height: 981, alpha: true } })
    expect(inspectPicture(webpBytes({ kind: 'VP8L', width: 760, height: 981 }))).toMatchObject({ info: { alpha: false } })
    expect(inspectPicture(webpBytes({ kind: 'VP8X', width: 4000, height: 3000, alpha: true }))).toEqual({ info: { contentType: 'image/webp', width: 4000, height: 3000, alpha: true } })
  })

  it('refuses an empty file, another type and a picture whose header cannot be read', () => {
    expect(inspectPicture(new Uint8Array())).toEqual({ refusal: { reason: 'empty' } })
    expect(inspectPicture(SVG_BYTES)).toEqual({ refusal: { reason: 'unsupported' } })
    expect(inspectPicture(GIF_BYTES)).toEqual({ refusal: { reason: 'unsupported' } })
    // A PNG signature without its IHDR, a JPEG whose data starts before any frame header, a WebP of an unknown kind.
    expect(inspectPicture(pngBytes().subarray(0, 12))).toEqual({ refusal: { reason: 'corrupt' } })
    expect(inspectPicture(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x08, 1, 1, 0, 0, 0x3f, 0, 0xff, 0xd9]))).toEqual({ refusal: { reason: 'corrupt' } })
    const unknownKind = webpBytes()
    unknownKind.set(text('ALPH'), 12)
    expect(inspectPicture(unknownKind)).toEqual({ refusal: { reason: 'corrupt' } })
  })

  it('refuses the dimensions the server refuses: a side under 64 or over 8000 px, or more than 40 million pixels', () => {
    expect(inspectPicture(pngBytes({ width: 63, height: 500 }))).toEqual({ refusal: { reason: 'dimensions', width: 63, height: 500 } })
    expect(inspectPicture(pngBytes({ width: 8001, height: 500 }))).toEqual({ refusal: { reason: 'dimensions', width: 8001, height: 500 } })
    expect(inspectPicture(webpBytes({ width: 8000, height: 5001 }))).toEqual({ refusal: { reason: 'dimensions', width: 8000, height: 5001 } })
    expect(inspectPicture(webpBytes({ width: 8000, height: 5000 }))).toMatchObject({ info: { width: 8000, height: 5000 } })
    expect(inspectPicture(pngBytes({ width: 64, height: 64 }))).toMatchObject({ info: { width: 64, height: 64 } })
  })
})

describe('EXIF orientation — a turned photo is measured as the browser shows it (a mirror of the server)', () => {
  it('reads the Orientation tag of IFD0 in both byte orders, and nothing from a malformed stream', () => {
    expect(readExifOrientation(new Uint8Array(exifTiff(6, 'II')))).toBe(6)
    expect(readExifOrientation(new Uint8Array(exifTiff(8, 'MM')))).toBe(8)
    expect(readExifOrientation(new Uint8Array(exifTiff(1, 'MM')))).toBe(1)
    expect(readExifOrientation(new Uint8Array(exifTiff(9)))).toBeNull()
    expect(readExifOrientation(text('II*'))).toBeNull()
    const wrongOrder = new Uint8Array(exifTiff(6))
    wrongOrder.set(text('XX'), 0)
    expect(readExifOrientation(wrongOrder)).toBeNull()
    const otherTag = new Uint8Array(exifTiff(6))
    otherTag.set([0x13, 0x01], 10)
    expect(readExifOrientation(otherTag)).toBeNull()
    expect(readExifOrientation(new Uint8Array(exifTiff(6)).subarray(0, 16))).toBeNull()
  })

  it('swaps the width and height of a JPEG (APP1 Exif) turned a quarter (5..8), in either byte order', () => {
    for (const orientation of [5, 6, 7, 8]) {
      expect(inspectPicture(jpegBytes({ width: 1000, height: 700, orientation, byteOrder: 'II' }))).toEqual({ info: { contentType: 'image/jpeg', width: 700, height: 1000, alpha: false } })
      expect(inspectPicture(jpegBytes({ width: 1000, height: 700, orientation, byteOrder: 'MM' }))).toMatchObject({ info: { width: 700, height: 1000 } })
    }
    // As stored (1), mirrored (2), upside down (3, 4): the same width and height.
    for (const orientation of [1, 2, 3, 4]) expect(inspectPicture(jpegBytes({ width: 1000, height: 700, orientation }))).toMatchObject({ info: { width: 1000, height: 700 } })
    // An APP1 that is not a usable EXIF block changes nothing.
    expect(inspectPicture(jpegBytes({ width: 1000, height: 700, exif: true }))).toMatchObject({ info: { width: 1000, height: 700 } })
  })

  it('swaps the width and height of a PNG (eXIf) turned a quarter, in either byte order, and keeps its transparency', () => {
    expect(inspectPicture(pngBytes({ width: 981, height: 760, orientation: 6, byteOrder: 'II' }))).toEqual({ info: { contentType: 'image/png', width: 760, height: 981, alpha: true } })
    expect(inspectPicture(pngBytes({ width: 981, height: 760, orientation: 8, byteOrder: 'MM', colourType: 2, tRNS: true }))).toEqual({ info: { contentType: 'image/png', width: 760, height: 981, alpha: true } })
    expect(inspectPicture(pngBytes({ width: 981, height: 760, orientation: 1 }))).toMatchObject({ info: { width: 981, height: 760 } })
  })

  it('checks the limits and warns on the turned size', () => {
    // Stored 9000 × 100 is refused whichever way it shows; the refusal names the size the browser would show.
    expect(inspectPicture(jpegBytes({ width: 9000, height: 100, orientation: 6 }))).toEqual({ refusal: { reason: 'dimensions', width: 100, height: 9000 } })
    const turned = inspectPicture(jpegBytes({ width: 981, height: 760, orientation: 6, byteOrder: 'MM' }))
    expect('info' in turned && pictureWarnings(HOME_IMAGE_SLOTS.heroStudent, turned.info)).toEqual(['jpegNoTransparency'])
    const upright = inspectPicture(jpegBytes({ width: 981, height: 760, orientation: 1 }))
    expect('info' in upright && pictureWarnings(HOME_IMAGE_SLOTS.heroStudent, upright.info)).toEqual(['small', 'smaller', 'jpegNoTransparency'])
  })
})

describe('sizeRefusal', () => {
  it('refuses an empty file and one over the limit, and lets the limit itself through', () => {
    expect(sizeRefusal(0, 5_242_880)).toEqual({ reason: 'empty' })
    expect(sizeRefusal(5_242_881, 5_242_880)).toEqual({ reason: 'tooLarge', bytes: 5_242_881, maxBytes: 5_242_880 })
    expect(sizeRefusal(5_242_880, 5_242_880)).toBeNull()
    expect(sizeRefusal(1, 5_242_880)).toBeNull()
  })
})

const info = (width: number, height: number, overrides: Partial<PictureInfo> = {}): PictureInfo => ({ contentType: 'image/png', width, height, alpha: true, ...overrides })

describe('pictureWarnings — how the picture will look in its frame (never a refusal)', () => {
  it('says nothing for a picture of the frame’s size and shape, or larger in the same proportions', () => {
    expect(pictureWarnings(HOME_IMAGE_SLOTS.heroStudent, info(760, 981))).toEqual([])
    expect(pictureWarnings(HOME_IMAGE_SLOTS.heroStudent, info(1520, 1962))).toEqual([])
    expect(pictureWarnings(HOME_IMAGE_SLOTS.aboutLearners, info(1920, 1360, { contentType: 'image/jpeg', alpha: false }))).toEqual([])
  })

  it('warns about a picture smaller than the frame', () => {
    expect(pictureWarnings(HOME_IMAGE_SLOTS.promoTraining, info(450, 280))).toEqual(['small'])
    expect(pictureWarnings(HOME_IMAGE_SLOTS.whyClassroom, info(800, 700))).toEqual(['small'])
  })

  it('warns about another shape: cut off in a cover frame, smaller in the contain frame of the hero', () => {
    // 1920 × 1080 is 26% wider than 960 × 680.
    expect(pictureWarnings(HOME_IMAGE_SLOTS.aboutLearners, info(1920, 1080, { contentType: 'image/jpeg', alpha: false }))).toEqual(['cropped'])
    expect(pictureWarnings(HOME_IMAGE_SLOTS.heroStudent, info(1600, 1000))).toEqual(['smaller'])
    expect(pictureWarnings(HOME_IMAGE_SLOTS.heroStudent, info(400, 300))).toEqual(['small', 'smaller'])
  })

  it('warns the hero about a JPEG and about a PNG or WebP that cannot hold a transparent pixel — the other places never', () => {
    expect(pictureWarnings(HOME_IMAGE_SLOTS.heroStudent, info(760, 981, { contentType: 'image/jpeg', alpha: false }))).toEqual(['jpegNoTransparency'])
    expect(pictureWarnings(HOME_IMAGE_SLOTS.heroStudent, info(760, 981, { alpha: false }))).toEqual(['opaqueBackground'])
    expect(pictureWarnings(HOME_IMAGE_SLOTS.heroStudent, info(760, 981, { contentType: 'image/webp', alpha: false }))).toEqual(['opaqueBackground'])
    expect(pictureWarnings(HOME_IMAGE_SLOTS.whyClassroom, info(800, 760, { contentType: 'image/jpeg', alpha: false }))).toEqual([])
  })

  it('adds the opaque-corners warning once, and never beside the JPEG one', () => {
    expect(withOpaqueCorners([])).toEqual(['opaqueBackground'])
    expect(withOpaqueCorners(['small'])).toEqual(['small', 'opaqueBackground'])
    expect(withOpaqueCorners(['opaqueBackground'])).toEqual(['opaqueBackground'])
    expect(withOpaqueCorners(['jpegNoTransparency'])).toEqual(['jpegNoTransparency'])
  })

  it('draws the shape line at 15% wider or narrower than the frame', () => {
    const frame = { width: 1000, height: 1000 }
    expect(shapeDiffers(frame, { width: 1140, height: 1000 })).toBe(false)
    expect(shapeDiffers(frame, { width: 1160, height: 1000 })).toBe(true)
    expect(shapeDiffers(frame, { width: 1000, height: 1140 })).toBe(false)
    expect(shapeDiffers(frame, { width: 1000, height: 1160 })).toBe(true)
  })
})

describe('cornersOpaque', () => {
  it('is true only when the four corner pixels are fully opaque', () => {
    const opaque = [0, 0, 0, 255, 1, 1, 1, 255, 2, 2, 2, 255, 3, 3, 3, 255]
    expect(cornersOpaque(opaque)).toBe(true)
    expect(cornersOpaque(opaque.map((value, index) => (index === 11 ? 254 : value)))).toBe(false)
    expect(cornersOpaque([0, 0, 0, 0])).toBe(false)
  })
})

describe('the screen’s small helpers', () => {
  it('names the types, writes sizes rounded up and keeps a size left to right', () => {
    expect(['image/png', 'image/jpeg', 'image/webp', null].map(pictureTypeLabel)).toEqual(['PNG', 'JPEG', 'WebP', ''])
    expect(fileSizeParts(5_242_880)).toEqual({ unit: 'mb', value: 5 })
    expect(fileSizeParts(5_242_881)).toEqual({ unit: 'mb', value: 5.1 })
    expect(fileSizeParts(1_258_291)).toEqual({ unit: 'mb', value: 1.2 })
    expect(fileSizeParts(80)).toEqual({ unit: 'kb', value: 1 })
    expect(fileSizeParts(812_345)).toEqual({ unit: 'kb', value: 794 })
    expect(isolateLtr('760 × 981')).toBe('\u2066760 × 981\u2069')
    expect(dimensionsText(760, 981)).toBe('\u2066760 × 981\u2069')
  })

  it('shows only the server’s root-relative media address, through the API base of the build', () => {
    const base = (path: string) => `https://api.example.test${path}`
    expect(publishedSrc('/api/academy/media/0123456789abcdef0123456789abcdef.png', base)).toBe('https://api.example.test/api/academy/media/0123456789abcdef0123456789abcdef.png')
    expect(publishedSrc(null, base)).toBeNull()
    expect(publishedSrc('https://elsewhere.example/x.png', base)).toBeNull()
    expect(publishedSrc('/somewhere/else.png', base)).toBeNull()
  })
})
