// J-F83 (Jallal's request): a lesson's link button in the look of the service it opens — a YouTube video as YouTube's
// red play button with the label inside, a Zoom meeting in Zoom's blue with a camera, a Google Meet call in Meet's
// white button with its four-colour camera (shapes close to theirs, drawn here — no logo file). Any other link keeps the
// academy's look: green «الانضمام» with a link icon, navy «مشاهدة الفيديو» with a play icon. Opens in a new tab.
import { LinkOutlined, PlayCircleOutlined } from '@ant-design/icons'
import { linkProviderOf } from './linkProvider'
import type { LinkProvider } from './linkProvider'

export interface LessonLinkButtonProps {
  url: string
  /** The words on the button («الانضمام» or «مشاهدة الفيديو»). */
  label: string
  /** The lesson's title, read after the label by a screen reader. */
  context: string
  /** The academy's own look when the link is not a known service: `join` green, `watch` navy. */
  kind: 'join' | 'watch'
}

export function LessonLinkButton({ url, label, context, kind }: LessonLinkButtonProps) {
  const provider = linkProviderOf(url)
  const look = provider ?? (kind === 'join' ? 'live' : 'play')
  return (
    <a className={`hub-btn hub-btn--${look}`} href={url} target="_blank" rel="noopener noreferrer" data-provider={provider ?? undefined}>
      {provider ? <ProviderIcon provider={provider} /> : kind === 'join' ? <LinkOutlined aria-hidden /> : <PlayCircleOutlined aria-hidden />} {label}
      <span className="hub-sr-only">: {context}</span>
    </a>
  )
}

/** The service's mark inside the button: YouTube's play triangle, Zoom's camera, Meet's four-colour camera. */
function ProviderIcon({ provider }: { provider: LinkProvider }) {
  if (provider === 'youtube') {
    return (
      <svg className="hub-btn__brand" viewBox="0 0 24 24" aria-hidden focusable="false">
        <path d="M8 5.5v13l10.5-6.5z" fill="currentColor" />
      </svg>
    )
  }
  if (provider === 'zoom') {
    return (
      <svg className="hub-btn__brand" viewBox="0 0 24 24" aria-hidden focusable="false">
        <rect x="2" y="6" width="13.5" height="12" rx="3" fill="currentColor" />
        <path d="M16.5 10.6 22 7v10l-5.5-3.6z" fill="currentColor" />
      </svg>
    )
  }
  return (
    <svg className="hub-btn__brand" viewBox="0 0 24 24" aria-hidden focusable="false">
      <path d="M2 9.2 5.2 6v3.2z" fill="#EA4335" />
      <rect x="2" y="9.2" width="3.2" height="8.8" fill="#4285F4" />
      <rect x="5.2" y="6" width="10" height="3.2" fill="#FBBC04" />
      <rect x="5.2" y="9.2" width="10" height="8.8" fill="#34A853" />
      <path d="M15.2 10.4 22 6.5v11l-6.8-3.9z" fill="#188038" />
    </svg>
  )
}
