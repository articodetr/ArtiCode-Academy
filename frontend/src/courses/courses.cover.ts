// PORTAL-04 phase 1: the pure rules of the course picture field. What a typed
// link means for the preview (the URL rule stays isCoverImageUrl(), the mirror
// of the server's; what may load stays coverSrc(), the rule of the public card)
// and which image load the preview may believe: an answer about an older link
// never overwrites a newer one. Unit-tested in courses.cover.test.ts.
import { coverSrc } from '../catalog/catalog.view'
import { isCoverImageUrl } from './courses.form'

/** How long the preview waits after the last keystroke. A pasted link does not wait. */
export const COVER_PREVIEW_DELAY_MS = 400
/** The recommended picture size: the public card's ratio (16 : 9), landscape. */
export const COVER_RECOMMENDED_WIDTH = 1280
export const COVER_RECOMMENDED_HEIGHT = 720

/**
 * What a form value means for the preview. `mixed` is a valid `http:` link on a
 * page that is not `http:`: it may be saved, yet the public card will not show it.
 */
export type CoverLink = { kind: 'empty' } | { kind: 'invalid' } | { kind: 'mixed' } | { kind: 'ready'; src: string }

export function coverLinkOf(value: string | null | undefined, origin?: string): CoverLink {
  const text = (value ?? '').trim()
  if (!text) return { kind: 'empty' }
  // First the URL rule: coverSrc() alone would accept a path on this origin.
  if (!isCoverImageUrl(text)) return { kind: 'invalid' }
  const src = coverSrc(text, origin)
  return src ? { kind: 'ready', src } : { kind: 'mixed' }
}

export type CoverLoadOutcome = 'loading' | 'loaded' | 'failed'

/** The one picture the preview is showing, and how its load went. */
export interface CoverLoad {
  src: string | null
  outcome: CoverLoadOutcome
}

export const NO_COVER_LOAD: CoverLoad = { src: null, outcome: 'loading' }

/** Starts loading `src`; the link already on show keeps its result. */
export function startCoverLoad(current: CoverLoad, src: string): CoverLoad {
  return current.src === src ? current : { src, outcome: 'loading' }
}

/** Records the answer of the image at `src`, unless the preview has moved on to another link. */
export function settleCoverLoad(current: CoverLoad, src: string, outcome: 'loaded' | 'failed'): CoverLoad {
  return current.src === src ? { src, outcome } : current
}

export type CoverPreviewState = 'empty' | 'invalid' | 'mixed' | CoverLoadOutcome

export function coverPreviewState(link: CoverLink, load: CoverLoad): CoverPreviewState {
  if (link.kind !== 'ready') return link.kind
  // The load may still be the previous link's (the debounce): its result says nothing about this one.
  return load.src === link.src ? load.outcome : 'loading'
}
