// TEST-172 — LR-01-T01: the HTML twin of the account e-mails (D-R77).
import { escapeHtml, renderMailHtml, textDirection } from './mail.html.js';

describe('renderMailHtml (TEST-172)', () => {
  it('writes Arabic right to left and English left to right, with the subject as the title', () => {
    const arabic = renderMailHtml('مرحباً سارة،', 'ar', 'دعوة');
    expect(arabic).toMatch(/^<!doctype html><html lang="ar" dir="rtl">/);
    expect(arabic).toContain('<title>دعوة</title>');
    expect(arabic).toContain('<div dir="rtl" style="max-width:560px;text-align:right">');

    const english = renderMailHtml('Hello', 'en', 'Invite');
    expect(english).toContain('<html lang="en" dir="ltr">');
    expect(english).toContain('text-align:left');
    expect(textDirection('tr')).toBe('ltr');
  });

  // TEST-215 — S6-C: a Turkish e-mail is Turkish and left to right, its letters escaped nowhere.
  it('writes Turkish left to right with lang="tr" and keeps its letters as they are', () => {
    const turkish = renderMailHtml('Merhaba Ayşe,\n\nŞu bağlantıyı açın:\nhttps://academy.example/invite/abc', 'tr', 'Arti Akademi davetiniz');
    expect(turkish).toMatch(/^<!doctype html><html lang="tr" dir="ltr">/);
    expect(turkish).toContain('<title>Arti Akademi davetiniz</title>');
    expect(turkish).toContain('<div dir="ltr" style="max-width:560px;text-align:left">');
    expect(turkish).toContain('<p style="margin:0 0 16px">Merhaba Ayşe,</p>');
    expect(turkish).toContain('Şu bağlantıyı açın:<br><a href="https://academy.example/invite/abc" dir="ltr"');
    expect(turkish).not.toContain('rtl');
  });

  it('makes paragraphs from blank lines, line breaks from newlines, and every URL a left-to-right link', () => {
    const html = renderMailHtml('First line\nopen:\nhttps://academy.example/invite/abc_-1\n\nLast.', 'en', 's');
    expect(html).toContain(
      '<p style="margin:0 0 16px">First line<br>open:<br>' +
        '<a href="https://academy.example/invite/abc_-1" dir="ltr" style="color:#1d4ed8;word-break:break-all">https://academy.example/invite/abc_-1</a></p>' +
        '<p style="margin:0 0 16px">Last.</p>',
    );
  });

  it('escapes everything that came from data — names, the academy name, the subject', () => {
    expect(escapeHtml(`<b>"Tom" & 'Jerry'</b>`)).toBe('&lt;b&gt;&quot;Tom&quot; &amp; &#39;Jerry&#39;&lt;/b&gt;');
    const html = renderMailHtml('Hello <script>alert(1)</script>, see https://a.example/x?y=1&z=2', 'en', '<i>s</i>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('<title>&lt;i&gt;s&lt;/i&gt;</title>');
    expect(html).toContain('href="https://a.example/x?y=1&amp;z=2"');
  });
});
