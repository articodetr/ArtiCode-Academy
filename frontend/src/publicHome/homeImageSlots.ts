// The four pictures of the public home page that the administration may replace
// (Settings → Homepage Images). The keys are the server's keys
// (`settings.homepageImages.<key>`) and the keys of HOME_IMAGES, which stays the
// built-in default of each place. `width`/`height` are the frame each picture
// is shown in on /home (publicHome.css): the admin preview uses the same frame,
// and a chosen picture whose shape differs from it gets a warning — it is never
// cropped or stretched here.
import { HOME_IMAGES } from './homeImages'

export const HOME_IMAGE_KEYS = ['heroStudent', 'aboutLearners', 'promoTraining', 'whyClassroom'] as const

export type HomeImageKey = (typeof HOME_IMAGE_KEYS)[number]

export interface HomeImageSlot {
  key: HomeImageKey
  /** The section of /home the picture belongs to. */
  section: 'hero' | 'about' | 'promo' | 'why'
  /** The built-in picture shown when the academy has none of its own (and when its own fails to load). */
  defaultSrc: string
  /** The frame on /home, in CSS pixels at its largest — also the recommended minimum size of an upload. */
  width: number
  height: number
  /** `contain`: the whole picture inside the frame (the hero's cut-out person); `cover`: the frame filled, edges may be hidden. */
  fit: 'contain' | 'cover'
  /** True for the hero: a picture with a transparent background (PNG or WebP) is expected. */
  transparent: boolean
}

export const HOME_IMAGE_SLOTS: Readonly<Record<HomeImageKey, HomeImageSlot>> = {
  heroStudent: { key: 'heroStudent', section: 'hero', defaultSrc: HOME_IMAGES.heroStudent, width: 760, height: 981, fit: 'contain', transparent: true },
  aboutLearners: { key: 'aboutLearners', section: 'about', defaultSrc: HOME_IMAGES.aboutLearners, width: 960, height: 680, fit: 'cover', transparent: false },
  promoTraining: { key: 'promoTraining', section: 'promo', defaultSrc: HOME_IMAGES.promoTraining, width: 900, height: 560, fit: 'cover', transparent: false },
  whyClassroom: { key: 'whyClassroom', section: 'why', defaultSrc: HOME_IMAGES.whyClassroom, width: 800, height: 760, fit: 'cover', transparent: false },
}

export function isHomeImageKey(value: unknown): value is HomeImageKey {
  return typeof value === 'string' && (HOME_IMAGE_KEYS as readonly string[]).includes(value)
}
