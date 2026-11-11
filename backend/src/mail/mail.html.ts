// HTML twin of the plain-text account e-mails (LR-01, D-R77): the same words,
// escaped, in the reading direction of the locale (Arabic right to left),
// with the links clickable and kept left to right. Pure, unit-tested in
// mail.html.spec.ts.
import type { LocaleCode } from '../authorization/localized-text.js';

const URL_PATTERN = /https?:\/\/[^\s<>"']+/g;

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

/** One line of text: escaped, with every http(s) URL as a left-to-right link. */
function renderLine(line: string): string {
  let html = '';
  let last = 0;
  for (const match of line.matchAll(URL_PATTERN)) {
    const url = match[0];
    html += escapeHtml(line.slice(last, match.index));
    html += `<a href="${escapeHtml(url)}" dir="ltr" style="color:#1d4ed8;word-break:break-all">${escapeHtml(url)}</a>`;
    last = match.index + url.length;
  }
  return html + escapeHtml(line.slice(last));
}

export function textDirection(locale: LocaleCode): 'rtl' | 'ltr' {
  return locale === 'ar' ? 'rtl' : 'ltr';
}

/** A minimal, self-contained HTML document: paragraphs from blank lines, line breaks from newlines. */
export function renderMailHtml(text: string, locale: LocaleCode, subject: string): string {
  const dir = textDirection(locale);
  const align = dir === 'rtl' ? 'right' : 'left';
  const paragraphs = text
    .split(/\n{2,}/)
    .map((paragraph) => `<p style="margin:0 0 16px">${paragraph.split('\n').map(renderLine).join('<br>')}</p>`)
    .join('');
  return (
    `<!doctype html><html lang="${locale}" dir="${dir}"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>` +
    `<body style="margin:0;padding:24px;background:#ffffff;color:#1f2937;font-family:Tahoma,Arial,sans-serif;font-size:15px;line-height:1.7">` +
    `<div dir="${dir}" style="max-width:560px;text-align:${align}">${paragraphs}</div></body></html>`
  );
}
