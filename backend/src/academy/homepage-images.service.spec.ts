// Homepage images — HomepageImagesService without a database or a disk: the
// boot sweep (off under NODE_ENV=test, never on unreadable settings), the
// media reference read from the settings alone, and the missing-file warning
// logged once per file.
import { Logger } from '@nestjs/common';
import { AcademyHttpException } from './academy.errors.js';
import { HomepageImagesService, MEDIA_SWEEP_MIN_AGE_MS } from './homepage-images.service.js';

const FILE = `${'7b'.repeat(16)}.png`;
const SETTINGS = {
  homepageImages: {
    heroStudent: { file: FILE, contentType: 'image/png', width: 760, height: 981, bytes: 10, updatedAt: '2026-11-24T10:00:00.000Z' },
    aboutLearners: { file: 'not-a-name', contentType: 'image/png', width: 1, height: 1, bytes: 1, updatedAt: '2026-11-24T10:00:00.000Z' },
  },
};

function makeService(options: { nodeEnv?: string; settings?: unknown; dbFails?: boolean } = {}) {
  const findFirst = options.dbFails ? vi.fn().mockRejectedValue(new Error('no database')) : vi.fn().mockResolvedValue({ settings: options.settings ?? SETTINGS });
  const storage = {
    sweep: vi.fn().mockResolvedValue({ temporary: 0, orphans: 0 }),
    open: vi.fn().mockResolvedValue(null),
    stat: vi.fn().mockResolvedValue(null),
  };
  const config = { get: (key: string) => (key === 'NODE_ENV' ? (options.nodeEnv ?? 'development') : 'api') };
  const service = new HomepageImagesService({ db: { academy: { findFirst } } } as never, { record: vi.fn() } as never, storage as never, config as never);
  return { service, storage, findFirst };
}

describe('HomepageImagesService', () => {
  afterEach(() => vi.restoreAllMocks());

  it('sweeps the media directory once at boot with the referenced names — but never under NODE_ENV=test', async () => {
    const { service, storage } = makeService({ nodeEnv: 'production' });
    service.onApplicationBootstrap();
    await vi.waitFor(() => expect(storage.sweep).toHaveBeenCalledTimes(1));
    const [referenced, minAge] = storage.sweep.mock.calls[0]!;
    expect([...(referenced as Set<string>)]).toEqual([FILE]); // the corrupt reference names nothing
    expect(minAge).toBe(MEDIA_SWEEP_MIN_AGE_MS);
    expect(MEDIA_SWEEP_MIN_AGE_MS).toBe(60 * 60 * 1000);

    const quiet = makeService({ nodeEnv: 'test' });
    quiet.service.onApplicationBootstrap();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(quiet.storage.sweep).not.toHaveBeenCalled();
  });

  it('deletes nothing when the settings cannot be read, and never fails the boot', async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { service, storage } = makeService({ dbFails: true });
    expect(() => service.onApplicationBootstrap()).not.toThrow();
    expect(await service.sweepMedia()).toBeNull();
    expect(storage.sweep).not.toHaveBeenCalled();
  });

  it('names a referenced picture, its type and a strong ETag from the settings alone (no disk access); anything else is 404', async () => {
    const { service, storage } = makeService();
    expect(await service.mediaReference(FILE)).toEqual({ file: FILE, contentType: 'image/png', etag: `"${'7b'.repeat(16)}"` });
    expect(storage.open).not.toHaveBeenCalled();
    expect(storage.stat).not.toHaveBeenCalled();
    for (const name of [`${'00'.repeat(16)}.png`, 'not-a-name', `../${FILE}`]) {
      const error = await service.mediaReference(name).catch((caught: unknown) => caught);
      expect(error, name).toBeInstanceOf(AcademyHttpException);
      expect((error as AcademyHttpException).code).toBe('media_not_found');
    }
  });

  it('answers 404 for a referenced file missing on disk, logging it once per file name', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { service } = makeService();
    const reference = await service.mediaReference(FILE);
    for (let i = 0; i < 3; i += 1) {
      await expect(service.openMedia(reference)).rejects.toMatchObject({ code: 'media_not_found' });
      await expect(service.statMedia(reference)).rejects.toMatchObject({ code: 'media_not_found' });
    }
    const messages = warn.mock.calls.map(([message]) => String(message)).filter((message) => message.includes(FILE));
    expect(messages).toHaveLength(1);
  });
});
