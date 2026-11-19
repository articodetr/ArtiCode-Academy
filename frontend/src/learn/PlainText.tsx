// Plain text of a lesson (D-R131): paragraphs split on blank lines, the line
// breaks inside one kept by `white-space: pre-line` (learn.css). Never HTML —
// React renders every paragraph as text, so a `<script>` in it shows as typed.
// Each paragraph takes its own direction: an English paragraph in the Arabic
// UI keeps its order.
import { paragraphsOf } from './learn.format'

export function PlainText({ text, className }: { text: string; className?: string }) {
  return (
    <div className={className ? `learn-text ${className}` : 'learn-text'}>
      {paragraphsOf(text).map((paragraph, index) => (
        <p key={index} dir="auto">
          {paragraph}
        </p>
      ))}
    </div>
  )
}
