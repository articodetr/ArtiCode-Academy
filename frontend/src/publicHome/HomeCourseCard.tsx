// One program on the public home page: the very card of /explore, so the two pages share one markup. The name stays
// an h3, under the section's h2.
import type { PublicCourseCard as PublicCourseCardData } from '../api/publicCatalog'
import { PublicCourseCard } from '../publicCatalog/PublicCourseCard'

export function HomeCourseCard({ card, href }: { card: PublicCourseCardData; href: string | null }) {
  return <PublicCourseCard card={card} href={href} />
}
