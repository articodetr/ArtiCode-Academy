// TEST-246 (unit part) — MOD-20 lesson content rules (D-R131/D-R134): the
// write-side check of every kind, the YouTube/Vimeo id extraction, the
// lenient read and the completion helpers — no database.
import {
  CAPTIONS_MAX,
  LEARNING_ITEM_KINDS,
  MEDIA_SECONDS_MAX,
  RESOURCES_MAX,
  TEXT_BODY_MAX,
  completionModeOf,
  displayDurationSecondsOf,
  parseLessonContent,
  parseLessonResources,
  playbackDurationOf,
  readLessonContent,
  readLessonResources,
  vimeoIdOf,
  youtubeIdOf,
} from './learning.content.js';
import type { LessonContent } from './learning.content.js';

const YT = 'dQw4w9WgXcQ';

function ok(kind: Parameters<typeof parseLessonContent>[0], input: unknown): LessonContent | null {
  const check = parseLessonContent(kind, input);
  if (!check.ok) throw new Error(`expected ok: ${check.problems.join('; ')}`);
  return check.content;
}

function problems(kind: Parameters<typeof parseLessonContent>[0], input: unknown): string[] {
  const check = parseLessonContent(kind, input);
  if (check.ok) throw new Error(`expected a refusal for ${JSON.stringify(input)}`);
  return check.problems;
}

describe('lesson content — every kind', () => {
  it('accepts null (no content yet) for every kind', () => {
    for (const kind of LEARNING_ITEM_KINDS) {
      expect(parseLessonContent(kind, null)).toEqual({ ok: true, content: null });
      expect(parseLessonContent(kind, undefined)).toEqual({ ok: true, content: null });
    }
  });

  it('text: a localized plain-text body, trimmed, blank optional locales dropped; ar required; at most TEXT_BODY_MAX', () => {
    expect(ok('text', { body: { ar: '  فقرة أولى\n\nفقرة ثانية  ', en: '  ', tr: 'Paragraf' } })).toEqual({ body: { ar: 'فقرة أولى\n\nفقرة ثانية', tr: 'Paragraf' } });
    expect(problems('text', { body: { en: 'no arabic' } }).some((p) => p.startsWith('body.ar'))).toBe(true);
    expect(problems('text', { body: { ar: '   ' } }).length).toBeGreaterThan(0);
    expect(problems('text', { body: { ar: 'x'.repeat(TEXT_BODY_MAX + 1) } }).length).toBeGreaterThan(0);
    expect(ok('text', { body: { ar: 'x'.repeat(TEXT_BODY_MAX) } })).toEqual({ body: { ar: 'x'.repeat(TEXT_BODY_MAX) } });
    expect(problems('text', { body: { ar: 'نص' }, html: '<b>x</b>' }).length).toBeGreaterThan(0); // strict: no unknown key
    expect(problems('text', { body: { ar: 'نص', fr: 'texte' } }).length).toBeGreaterThan(0);
    expect(problems('text', {}).length).toBeGreaterThan(0);
  });

  it('video (file): an https media URL with its length in seconds; captions only here, at most CAPTIONS_MAX', () => {
    expect(ok('video', { provider: 'file', url: 'https://cdn.example.org/v.mp4', durationSeconds: 600 })).toEqual({
      provider: 'file',
      url: 'https://cdn.example.org/v.mp4',
      durationSeconds: 600,
      captions: [],
    });
    const captions = [{ language: 'ar', url: 'https://cdn.example.org/v.ar.vtt', label: 'العربية' }];
    expect(ok('video', { provider: 'file', url: 'https://cdn.example.org/v.mp4', durationSeconds: 600, captions })).toMatchObject({ captions });
    // A file video without a duration cannot be measured (D-R134).
    expect(problems('video', { provider: 'file', url: 'https://cdn.example.org/v.mp4' }).some((p) => p.startsWith('durationSeconds'))).toBe(true);
    expect(problems('video', { provider: 'file', url: 'https://cdn.example.org/v.mp4', durationSeconds: null }).length).toBeGreaterThan(0);
    expect(problems('video', { provider: 'file', url: 'https://cdn.example.org/v.mp4', durationSeconds: 0 }).length).toBeGreaterThan(0);
    expect(problems('video', { provider: 'file', url: 'https://cdn.example.org/v.mp4', durationSeconds: 1.5 }).length).toBeGreaterThan(0);
    expect(problems('video', { provider: 'file', url: 'https://cdn.example.org/v.mp4', durationSeconds: MEDIA_SECONDS_MAX + 1 }).length).toBeGreaterThan(0);
    const tooMany = Array.from({ length: CAPTIONS_MAX + 1 }, () => captions[0]);
    expect(problems('video', { provider: 'file', url: 'https://cdn.example.org/v.mp4', durationSeconds: 60, captions: tooMany }).length).toBeGreaterThan(0);
    expect(problems('video', { provider: 'file', url: 'https://cdn.example.org/v.mp4', durationSeconds: 60, captions: [{ language: 'fr', url: 'https://x.org/a.vtt' }] }).length).toBeGreaterThan(0);
    expect(problems('video', { provider: 'file', url: 'https://cdn.example.org/v.mp4', durationSeconds: 60, captions: [{ language: 'ar', url: 'http://x.org/a.vtt' }] }).length).toBeGreaterThan(0);
  });

  it('video (youtube/vimeo): stored as the provider’s video id with a canonical URL; the duration is optional; no captions', () => {
    expect(ok('video', { provider: 'youtube', url: `https://youtu.be/${YT}` })).toEqual({
      provider: 'youtube',
      videoId: YT,
      url: `https://www.youtube.com/watch?v=${YT}`,
      durationSeconds: null,
    });
    expect(ok('video', { provider: 'vimeo', url: 'https://vimeo.com/76979871', durationSeconds: 120 })).toEqual({
      provider: 'vimeo',
      videoId: '76979871',
      url: 'https://vimeo.com/76979871',
      durationSeconds: 120,
    });
    expect(problems('video', { provider: 'youtube', url: 'https://vimeo.com/76979871' }).some((p) => p.startsWith('url'))).toBe(true);
    expect(problems('video', { provider: 'vimeo', url: `https://www.youtube.com/watch?v=${YT}` }).length).toBeGreaterThan(0);
    expect(problems('video', { provider: 'youtube', url: `https://youtu.be/${YT}`, captions: [{ language: 'ar', url: 'https://x.org/a.vtt' }] }).some((p) => p.startsWith('captions'))).toBe(true);
    expect(ok('video', { provider: 'youtube', url: `https://youtu.be/${YT}`, captions: [] })).toMatchObject({ videoId: YT });
    expect(problems('video', { provider: 'dailymotion', url: 'https://dailymotion.com/x' }).length).toBeGreaterThan(0);
    // The stored shape is not an input: `videoId` is refused on the write side.
    expect(problems('video', { provider: 'youtube', videoId: YT, url: `https://youtu.be/${YT}` }).length).toBeGreaterThan(0);
  });

  it('audio: an https URL with its length (required, 1..MEDIA_SECONDS_MAX)', () => {
    expect(ok('audio', { url: 'https://cdn.example.org/a.mp3', durationSeconds: 90 })).toEqual({ url: 'https://cdn.example.org/a.mp3', durationSeconds: 90 });
    expect(problems('audio', { url: 'https://cdn.example.org/a.mp3' }).length).toBeGreaterThan(0);
    expect(problems('audio', { url: 'https://cdn.example.org/a.mp3', durationSeconds: '90' }).length).toBeGreaterThan(0);
  });

  it('pdf, image and file: an https URL; image alt and file name are optional and read as null', () => {
    expect(ok('pdf', { url: 'https://cdn.example.org/a.pdf' })).toEqual({ url: 'https://cdn.example.org/a.pdf' });
    expect(ok('image', { url: 'https://cdn.example.org/a.png' })).toEqual({ url: 'https://cdn.example.org/a.png', alt: null });
    expect(ok('image', { url: 'https://cdn.example.org/a.png', alt: { ar: 'مخطط' } })).toEqual({ url: 'https://cdn.example.org/a.png', alt: { ar: 'مخطط' } });
    expect(ok('file', { url: 'https://cdn.example.org/a.zip', fileName: ' a.zip ' })).toEqual({ url: 'https://cdn.example.org/a.zip', fileName: 'a.zip' });
    expect(ok('file', { url: 'https://cdn.example.org/a.zip', fileName: null })).toEqual({ url: 'https://cdn.example.org/a.zip', fileName: null });
    expect(problems('pdf', {}).length).toBeGreaterThan(0);
    expect(problems('image', { url: 'https://cdn.example.org/a.png', alt: { en: 'x' } }).length).toBeGreaterThan(0);
    expect(problems('file', { url: 'https://cdn.example.org/a.zip', fileName: '' }).length).toBeGreaterThan(0);
  });

  it('live: an optional note', () => {
    expect(ok('live', {})).toEqual({ note: null });
    expect(ok('live', { note: { ar: 'نلتقي في القاعة' } })).toEqual({ note: { ar: 'نلتقي في القاعة' } });
    expect(problems('live', { note: 'plain' }).length).toBeGreaterThan(0);
  });

  it('refuses anything but an absolute https URL without white space (http is mixed content)', () => {
    for (const url of ['http://cdn.example.org/a.pdf', 'ftp://cdn.example.org/a.pdf', '//cdn.example.org/a.pdf', '/a.pdf', 'https://cdn.example.org/a b.pdf', 'javascript:alert(1)', `https://${'a'.repeat(2048)}`]) {
      expect(parseLessonContent('pdf', { url }).ok, url.slice(0, 40)).toBe(false);
    }
    expect(ok('pdf', { url: '  https://cdn.example.org/a.pdf  ' })).toEqual({ url: 'https://cdn.example.org/a.pdf' });
  });
});

describe('YouTube and Vimeo ids', () => {
  it('reads the id of every YouTube URL form', () => {
    for (const url of [
      `https://www.youtube.com/watch?v=${YT}`,
      `https://youtube.com/watch?v=${YT}&t=42s`,
      `https://m.youtube.com/watch?v=${YT}`,
      `https://youtu.be/${YT}?t=10`,
      `https://www.youtube.com/embed/${YT}`,
      `https://www.youtube-nocookie.com/embed/${YT}`,
      `https://www.youtube.com/shorts/${YT}`,
      `https://www.youtube.com/live/${YT}`,
    ]) {
      expect(youtubeIdOf(url), url).toBe(YT);
    }
    for (const url of [
      `http://www.youtube.com/watch?v=${YT}`,
      'https://www.youtube.com/watch?v=short',
      'https://www.youtube.com/channel/UC123',
      `https://evil.example/watch?v=${YT}`,
      `https://youtube.com.evil.example/watch?v=${YT}`,
      'not a url',
    ]) {
      expect(youtubeIdOf(url), url).toBeNull();
    }
  });

  it('reads the id of vimeo.com and player.vimeo.com URLs', () => {
    expect(vimeoIdOf('https://vimeo.com/76979871')).toBe('76979871');
    expect(vimeoIdOf('https://www.vimeo.com/channels/staffpicks/76979871')).toBe('76979871');
    expect(vimeoIdOf('https://player.vimeo.com/video/76979871?h=abc')).toBe('76979871');
    expect(vimeoIdOf('http://vimeo.com/76979871')).toBeNull();
    expect(vimeoIdOf('https://vimeo.com/about')).toBeNull();
    expect(vimeoIdOf('https://player.vimeo.com/album/123')).toBeNull();
    expect(vimeoIdOf('https://evil.example/76979871')).toBeNull();
    expect(vimeoIdOf('nope')).toBeNull();
  });
});

describe('resources', () => {
  it('accepts up to RESOURCES_MAX https links with a localized title; null/undefined = none', () => {
    const one = { title: { ar: 'ملف التمارين', en: ' ' }, url: 'https://cdn.example.org/ex.pdf' };
    expect(parseLessonResources([one])).toEqual({ ok: true, resources: [{ title: { ar: 'ملف التمارين' }, url: 'https://cdn.example.org/ex.pdf' }] });
    expect(parseLessonResources(null)).toEqual({ ok: true, resources: [] });
    expect(parseLessonResources(undefined)).toEqual({ ok: true, resources: [] });
    expect(parseLessonResources(Array.from({ length: RESOURCES_MAX }, () => one)).ok).toBe(true);
    expect(parseLessonResources(Array.from({ length: RESOURCES_MAX + 1 }, () => one)).ok).toBe(false);
    expect(parseLessonResources([{ ...one, url: 'http://cdn.example.org/ex.pdf' }]).ok).toBe(false);
    expect(parseLessonResources([{ title: { en: 'x' }, url: 'https://cdn.example.org/ex.pdf' }]).ok).toBe(false);
    expect(parseLessonResources([{ ...one, extra: true }]).ok).toBe(false);
    expect(parseLessonResources({ title: one.title, url: one.url }).ok).toBe(false);
  });

  it('reads stored resources leniently: anything that no longer fits is []', () => {
    expect(readLessonResources([{ title: { ar: 'م' }, url: 'https://x.org/a' }])).toEqual([{ title: { ar: 'م' }, url: 'https://x.org/a' }]);
    expect(readLessonResources([{ title: 'old', url: 'https://x.org/a' }])).toEqual([]);
    expect(readLessonResources('nope')).toEqual([]);
    expect(readLessonResources(null)).toEqual([]);
  });
});

describe('lenient read of the stored content', () => {
  it('round-trips the stored shape of every kind (the write schema is idempotent on its output)', () => {
    const samples: [Parameters<typeof parseLessonContent>[0], unknown][] = [
      ['text', { body: { ar: 'نص', en: 'Text' } }],
      ['video', { provider: 'file', url: 'https://cdn.example.org/v.mp4', durationSeconds: 600, captions: [{ language: 'en', url: 'https://cdn.example.org/v.vtt' }] }],
      ['video', { provider: 'youtube', url: `https://youtu.be/${YT}`, durationSeconds: 300 }],
      ['video', { provider: 'vimeo', url: 'https://player.vimeo.com/video/76979871' }],
      ['audio', { url: 'https://cdn.example.org/a.mp3', durationSeconds: 90 }],
      ['pdf', { url: 'https://cdn.example.org/a.pdf' }],
      ['image', { url: 'https://cdn.example.org/a.png', alt: { ar: 'صورة' } }],
      ['file', { url: 'https://cdn.example.org/a.zip', fileName: 'a.zip' }],
      ['live', { note: { ar: 'ملاحظة' } }],
    ];
    for (const [kind, input] of samples) {
      const stored = ok(kind, input);
      // jsonb round trip: the stored value comes back as plain JSON.
      const fromDb = JSON.parse(JSON.stringify(stored)) as unknown;
      expect(readLessonContent(kind, fromDb), kind).toEqual(stored);
    }
  });

  it('a stored youtube object with its videoId reads back unchanged', () => {
    const stored = { provider: 'youtube', videoId: YT, url: `https://www.youtube.com/watch?v=${YT}`, durationSeconds: null };
    expect(readLessonContent('video', stored)).toEqual(stored);
  });

  it('reads a value that no longer fits its kind as null, never failing', () => {
    expect(readLessonContent('text', null)).toBeNull();
    expect(readLessonContent('text', 'plain')).toBeNull();
    expect(readLessonContent('text', [{ body: { ar: 'x' } }])).toBeNull();
    expect(readLessonContent('text', { url: 'https://x.org/a.pdf' })).toBeNull(); // the content of another kind
    expect(readLessonContent('pdf', { url: 'http://x.org/a.pdf' })).toBeNull();
    expect(readLessonContent('video', { provider: 'file', url: 'https://x.org/v.mp4' })).toBeNull(); // no duration
    expect(readLessonContent('audio', 42)).toBeNull();
  });
});

describe('completion (D-R134)', () => {
  const fileVideo = ok('video', { provider: 'file', url: 'https://cdn.example.org/v.mp4', durationSeconds: 600 });
  const youtube = ok('video', { provider: 'youtube', url: `https://youtu.be/${YT}`, durationSeconds: 300 });
  const vimeo = ok('video', { provider: 'vimeo', url: 'https://vimeo.com/76979871' });
  const audio = ok('audio', { url: 'https://cdn.example.org/a.mp3', durationSeconds: 90 });
  const text = ok('text', { body: { ar: 'نص' } });
  const pdf = ok('pdf', { url: 'https://cdn.example.org/a.pdf' });

  it('completionModeOf: playback for a file video and audio, attendance for live, manual for everything else', () => {
    expect(completionModeOf('video', fileVideo)).toBe('playback');
    expect(completionModeOf('audio', audio)).toBe('playback');
    expect(completionModeOf('video', youtube)).toBe('manual');
    expect(completionModeOf('video', vimeo)).toBe('manual');
    expect(completionModeOf('text', text)).toBe('manual');
    expect(completionModeOf('pdf', pdf)).toBe('manual');
    expect(completionModeOf('image', null)).toBe('manual');
    expect(completionModeOf('file', null)).toBe('manual');
    // A media lesson without content yet completes by the button; a live lesson always by attendance.
    expect(completionModeOf('video', null)).toBe('manual');
    expect(completionModeOf('audio', null)).toBe('manual');
    expect(completionModeOf('live', null)).toBe('attendance');
    expect(completionModeOf('live', ok('live', {}))).toBe('attendance');
  });

  it('playbackDurationOf: the authored length of a measured medium, else null', () => {
    expect(playbackDurationOf('video', fileVideo)).toBe(600);
    expect(playbackDurationOf('audio', audio)).toBe(90);
    expect(playbackDurationOf('video', youtube)).toBeNull();
    expect(playbackDurationOf('video', null)).toBeNull();
    expect(playbackDurationOf('text', text)).toBeNull();
    expect(playbackDurationOf('live', null)).toBeNull();
  });

  it('displayDurationSecondsOf: the media length when known, else the estimate in seconds, else null', () => {
    expect(displayDurationSecondsOf('video', fileVideo, 5)).toBe(600);
    expect(displayDurationSecondsOf('video', youtube, null)).toBe(300);
    expect(displayDurationSecondsOf('video', vimeo, 12)).toBe(720); // no length on the stored vimeo video
    expect(displayDurationSecondsOf('audio', audio, null)).toBe(90);
    expect(displayDurationSecondsOf('text', text, 45)).toBe(2700);
    expect(displayDurationSecondsOf('pdf', pdf, null)).toBeNull();
    expect(displayDurationSecondsOf('video', null, 10)).toBe(600);
    expect(displayDurationSecondsOf('live', null, null)).toBeNull();
  });
});
