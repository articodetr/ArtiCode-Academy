// The light formatting of a course's description (PORTAL-04 course page polish): the academy types it as plain text and
// often marks a line as a heading with **…** and a list with «- » or «1. ». This reads those marks into blocks — a
// heading, a paragraph (its own line breaks kept), a list — and **bold** inside a line. Never HTML: the page renders
// every block as React text, so a `<b>` or a `<script>` shows as typed. Any other mark stays as written.

export interface CourseTextRun {
  text: string
  strong: boolean
}

export type CourseTextBlock =
  | { kind: 'heading'; runs: CourseTextRun[] }
  | { kind: 'paragraph'; lines: CourseTextRun[][] }
  | { kind: 'list'; ordered: boolean; items: CourseTextRun[][] }

const BULLET = /^\s*[-*•–]\s+/
// Latin or Arabic-Indic digits, then «.» or «)».
const ORDERED = /^\s*(?:\d{1,3}|[٠-٩]{1,3})[.)]\s+/
const HASH_HEADING = /^\s*#{1,6}\s+/
// A line that is bold as a whole (optionally ending in a colon) reads as a heading.
const BOLD_LINE = /^\s*\*\*([^*]+?)\*\*\s*:?\s*$/
const BOLD = /\*\*([^*]+?)\*\*/g

/** The runs of one line: the text between a pair of ** is strong; an unpaired ** stays as typed. */
export function runsOf(line: string): CourseTextRun[] {
  const runs: CourseTextRun[] = []
  let last = 0
  for (const match of line.matchAll(BOLD)) {
    const start = match.index ?? 0
    if (start > last) runs.push({ text: line.slice(last, start), strong: false })
    runs.push({ text: match[1]!, strong: true })
    last = start + match[0].length
  }
  if (last < line.length) runs.push({ text: line.slice(last), strong: false })
  return runs.length > 0 ? runs : [{ text: line, strong: false }]
}

/** The blocks of a description, in order. A blank line ends a paragraph or a list. */
export function courseTextBlocks(text: string): CourseTextBlock[] {
  const blocks: CourseTextBlock[] = []
  let paragraph: string[] = []
  let list: { ordered: boolean; items: string[] } | null = null

  const flushParagraph = () => {
    if (paragraph.length > 0) blocks.push({ kind: 'paragraph', lines: paragraph.map(runsOf) })
    paragraph = []
  }
  const flushList = () => {
    if (list && list.items.length > 0) blocks.push({ kind: 'list', ordered: list.ordered, items: list.items.map(runsOf) })
    list = null
  }
  const addItem = (ordered: boolean, item: string) => {
    flushParagraph()
    if (!list || list.ordered !== ordered) {
      flushList()
      list = { ordered, items: [] }
    }
    list.items.push(item)
  }

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '') {
      flushParagraph()
      flushList()
      continue
    }
    if (HASH_HEADING.test(line)) {
      flushParagraph()
      flushList()
      blocks.push({ kind: 'heading', runs: runsOf(line.replace(HASH_HEADING, '')) })
      continue
    }
    const bold = BOLD_LINE.exec(line)
    if (bold) {
      flushParagraph()
      flushList()
      blocks.push({ kind: 'heading', runs: [{ text: bold[1]!.trim(), strong: false }] })
      continue
    }
    if (BULLET.test(line)) {
      addItem(false, line.replace(BULLET, ''))
      continue
    }
    if (ORDERED.test(line)) {
      addItem(true, line.replace(ORDERED, ''))
      continue
    }
    flushList()
    paragraph.push(line)
  }
  flushParagraph()
  flushList()
  return blocks
}
