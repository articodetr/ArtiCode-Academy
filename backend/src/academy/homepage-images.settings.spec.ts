// Homepage images — the references in `academy.settings.homepageImages`
// (homepage-images.settings.ts): a lenient reader, a writer that keeps every
// other setting, and the public URLs of API-205. The PATCH-able settings
// (academy.settings.ts) neither read nor write the domain.
import { applySettingsChanges, readSettings } from './academy.settings.js';
import {
  HOMEPAGE_IMAGE_KEYS,
  hasStoredHomepageImage,
  isFileReferenced,
  isHomepageImageKey,
  isMediaFileName,
  mediaUrl,
  publicHomepageImageUrls,
  readHomepageImages,
  referenceOfFile,
  writeHomepageImage,
} from './homepage-images.settings.js';
import type { HomepageImageReference } from './homepage-images.settings.js';

const FILE = `${'0a'.repeat(16)}.png`;
const OTHER = `${'1b'.repeat(16)}.webp`;

function reference(overrides: Partial<HomepageImageReference> = {}): HomepageImageReference {
  return { file: FILE, contentType: 'image/png', width: 760, height: 981, bytes: 51234, updatedAt: '2026-11-24T09:00:00.000Z', ...overrides };
}

const NONE = { heroStudent: null, aboutLearners: null, promoTraining: null, whyClassroom: null };

describe('homepage images — the stored references', () => {
  it('names the four keys in a fixed order and recognises keys and file names exactly', () => {
    expect(HOMEPAGE_IMAGE_KEYS).toEqual(['heroStudent', 'aboutLearners', 'promoTraining', 'whyClassroom']);
    expect(isHomepageImageKey('heroStudent')).toBe(true);
    for (const other of ['HeroStudent', 'hero', '', 'constructor', '__proto__', undefined, 1]) expect(isHomepageImageKey(other), String(other)).toBe(false);
    expect(isMediaFileName(FILE)).toBe(true);
    expect(isMediaFileName(OTHER)).toBe(true);
    for (const bad of [
      `${'0A'.repeat(16)}.png`,
      `${'0a'.repeat(15)}.png`,
      `${'0a'.repeat(16)}.gif`,
      `${'0a'.repeat(16)}.PNG`,
      `${'0a'.repeat(16)}.jpeg`,
      `../${FILE}`,
      `x/${FILE}`,
      `${FILE}/`,
      `${FILE}\n`,
      '..',
      '',
    ]) {
      expect(isMediaFileName(bad), bad).toBe(false);
    }
  });

  it('reads no custom picture from empty or foreign settings', () => {
    for (const settings of [null, undefined, {}, [], 'x', 42, { homepageImages: null }, { homepageImages: [] }, { homepageImages: 'x' }, { catalog: { publicBrowsing: true } }]) {
      expect(readHomepageImages(settings), JSON.stringify(settings)).toEqual(NONE);
    }
  });

  it('reads a valid reference, and a corrupt one as no custom picture (lenient)', () => {
    const settings = {
      homepageImages: {
        heroStudent: reference(),
        aboutLearners: reference({ file: '../../etc/passwd' }),
        promoTraining: reference({ file: `${'2c'.repeat(16)}.jpg`, contentType: 'image/png' }), // extension ≠ type
        whyClassroom: { ...reference({ file: OTHER, contentType: 'image/webp' }), width: -1 },
      },
    };
    expect(readHomepageImages(settings)).toEqual({ ...NONE, heroStudent: reference() });
    for (const corrupt of [
      'a string',
      [],
      {},
      { ...reference(), contentType: 'image/svg+xml' },
      { ...reference(), width: 1.5 },
      { ...reference(), height: 0 },
      { ...reference(), bytes: '12' },
      { ...reference(), updatedAt: 'yesterday' },
      { file: FILE, contentType: 'image/png', width: 1, height: 1, bytes: 1 },
    ]) {
      expect(readHomepageImages({ homepageImages: { heroStudent: corrupt } }).heroStudent, JSON.stringify(corrupt)).toBeNull();
    }
  });

  it('writes a reference into a copy, keeping every other domain and key, known or not; null removes it and an empty domain goes', () => {
    const stored = {
      scheduling: { weekStartsOn: 6 },
      futureDomain: { a: 1 },
      homepageImages: { aboutLearners: reference({ file: OTHER, contentType: 'image/webp' }), legacyKey: { x: 1 } },
    };
    const snapshot = structuredClone(stored);
    const written = writeHomepageImage(stored, 'heroStudent', reference());
    expect(stored).toEqual(snapshot); // the input is never mutated
    expect(written).toEqual({ ...stored, homepageImages: { ...stored.homepageImages, heroStudent: reference() } });

    const cleared = writeHomepageImage(written, 'heroStudent', null);
    expect(cleared).toEqual(stored);
    const onlyOne = writeHomepageImage({ homepageImages: { heroStudent: reference() } }, 'heroStudent', null);
    expect(onlyOne).toEqual({});
    expect(writeHomepageImage(null, 'whyClassroom', reference())).toEqual({ homepageImages: { whyClassroom: reference() } });
  });

  it('tells whether anything is stored under a key, valid or not', () => {
    expect(hasStoredHomepageImage({ homepageImages: { heroStudent: 'corrupt' } }, 'heroStudent')).toBe(true);
    expect(hasStoredHomepageImage({ homepageImages: { heroStudent: reference() } }, 'aboutLearners')).toBe(false);
    expect(hasStoredHomepageImage({}, 'heroStudent')).toBe(false);
  });

  it('finds a file only through a valid reference of the current settings', () => {
    const settings = { homepageImages: { promoTraining: reference(), whyClassroom: { file: OTHER } } };
    expect(referenceOfFile(settings, FILE)).toEqual(reference());
    expect(isFileReferenced(settings, FILE)).toBe(true);
    expect(referenceOfFile(settings, OTHER)).toBeNull(); // only a corrupt entry names it
    expect(referenceOfFile(settings, `../${FILE}`)).toBeNull();
    expect(referenceOfFile({}, FILE)).toBeNull();
    expect(isFileReferenced(writeHomepageImage(settings, 'promoTraining', null), FILE)).toBe(false);
  });

  it('builds the root-relative media URL below the API prefix, and the public URLs of API-205', () => {
    expect(mediaUrl('api', FILE)).toBe(`/api/academy/media/${FILE}`);
    expect(mediaUrl('api/v1', FILE)).toBe(`/api/v1/academy/media/${FILE}`);
    expect(mediaUrl('/api/', FILE)).toBe(`/api/academy/media/${FILE}`);
    expect(publicHomepageImageUrls({ homepageImages: { whyClassroom: reference() } }, 'api')).toEqual({ ...NONE, whyClassroom: `/api/academy/media/${FILE}` });
    expect(publicHomepageImageUrls({}, 'api')).toEqual(NONE);
  });

  it('is invisible to the PATCH-able settings: readSettings ignores the domain and applySettingsChanges keeps it', () => {
    const stored = { learning: { videoCompletionPercent: 80 }, homepageImages: { heroStudent: reference() } };
    expect(Object.keys(readSettings(stored))).toEqual(['scheduling', 'certificates', 'learning', 'catalog']);
    const patched = applySettingsChanges(stored, [['settings.learning.videoCompletionPercent', null]]);
    expect(patched).toEqual({ homepageImages: { heroStudent: reference() } });
  });
});
