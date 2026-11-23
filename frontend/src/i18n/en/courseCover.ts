// PORTAL-04 phase 1: the course picture field — English of ../ar/courseCover.ts.
import type { courseCover as arCourseCover } from '../ar/courseCover'

export const courseCover: typeof arCourseCover = {
  clear: 'Clear the picture link',
  sizeLabel: 'Recommended size:',
  sizeNote: 'or larger, landscape',
  states: {
    empty: 'The course picture will appear here',
    invalid: 'To see a preview, enter a full link starting with',
    loading: 'Loading the picture…',
    loaded: 'This is how the picture will look on the course card',
    failed: 'The picture could not be loaded from this link. Make sure it is a direct link to an image.',
    failedNote: 'You can still save: the image host may only be down for now.',
    mixed: 'This link is not secure while this site is, so visitors will not see the picture. Use a link starting with',
  },
}
