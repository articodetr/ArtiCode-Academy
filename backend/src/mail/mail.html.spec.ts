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
