// A course's description on its page (PORTAL-04 course page polish): paragraphs, subheadings and lists read from the
// academy's plain text by courseTextBlocks(). Every block is React text — never HTML — and takes its own direction, so
// an English paragraph in the Arabic UI keeps its order.
import { Fragment } from 'react'
import { courseTextBlocks } from './courseText'
import type { CourseTextRun } from './courseText'

function Runs({ runs }: { runs: CourseTextRun[] }) {
  return (
    <>
      {runs.map((run, index) => (run.strong ? <strong key={index}>{run.text}</strong> : <Fragment key={index}>{run.text}</Fragment>))}
    </>
  )
}

export function CourseDescription({ text }: { text: string }) {
  return (
    <div className="catalog-course__description">
      {courseTextBlocks(text).map((block, index) => {
        if (block.kind === 'heading') {
          return (
            <h3 key={index} className="catalog-course__description-heading" dir="auto">
              <Runs runs={block.runs} />
            </h3>
          )
        }
        if (block.kind === 'list') {
          const List = block.ordered ? 'ol' : 'ul'
          return (
            <List key={index} className="catalog-course__description-list" dir="auto">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>
                  <Runs runs={item} />
                </li>
              ))}
            </List>
          )
        }
        return (
          <p key={index} className="catalog-course__description-text" dir="auto">
            {block.lines.map((line, lineIndex) => (
              <Fragment key={lineIndex}>
                {lineIndex > 0 ? <br /> : null}
                <Runs runs={line} />
              </Fragment>
            ))}
          </p>
        )
      })}
    </div>
  )
}
