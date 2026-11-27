// J-F83 (TEST-346): the service a lesson's link opens, by its host.
import { describe, expect, it } from 'vitest'
import { linkProviderOf } from './linkProvider'

describe('linkProviderOf', () => {
  it('knows YouTube in its usual forms', () => {
    for (const url of ['https://www.youtube.com/watch?v=abc', 'https://youtube.com/live/abc', 'https://m.youtube.com/watch?v=abc', 'https://youtu.be/abc', 'https://www.youtube-nocookie.com/embed/abc']) {
      expect(linkProviderOf(url)).toBe('youtube')
    }
  })

  it('knows Zoom, with its regional subdomains, and Google Meet', () => {
    expect(linkProviderOf('https://us02web.zoom.us/j/123?pwd=x')).toBe('zoom')
    expect(linkProviderOf('https://zoom.us/j/123')).toBe('zoom')
    expect(linkProviderOf('https://app.zoom.com/wc/123')).toBe('zoom')
    expect(linkProviderOf('https://meet.google.com/abc-defg-hij')).toBe('meet')
  })

  it('leaves any other host, a look-alike host and a broken link to the academy’s own look', () => {
    expect(linkProviderOf('https://meet.example.com/room')).toBeNull()
    expect(linkProviderOf('https://notyoutube.com/watch')).toBeNull()
    expect(linkProviderOf('https://youtube.com.evil.example/x')).toBeNull()
    expect(linkProviderOf('https://google.com/meet')).toBeNull()
    expect(linkProviderOf('not a link')).toBeNull()
    expect(linkProviderOf(null)).toBeNull()
    expect(linkProviderOf('')).toBeNull()
  })
})
