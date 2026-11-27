// J-F83: which service a lesson's link opens — YouTube, Zoom or Google Meet — read from the link's host only, so its
// button can take that service's look (`LessonLinkButton`). Any other host, or a link that does not parse, is null:
// the button keeps the academy's own look. Unit-tested in linkProvider.test.ts.

export const LINK_PROVIDERS = ['youtube', 'zoom', 'meet'] as const
export type LinkProvider = (typeof LINK_PROVIDERS)[number]

/** The host equals the domain or is one of its subdomains (`us02web.zoom.us`, `m.youtube.com`). */
function within(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`)
}

export function linkProviderOf(url: string | null | undefined): LinkProvider | null {
  if (!url) return null
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
  if (within(host, 'youtube.com') || within(host, 'youtu.be') || within(host, 'youtube-nocookie.com')) return 'youtube'
  if (within(host, 'zoom.us') || within(host, 'zoom.com') || within(host, 'zoomgov.com')) return 'zoom'
  if (host === 'meet.google.com') return 'meet'
  return null
}
