// A guard over the source (KI-120): no antd Typography carries a `dir` attribute. In the Arabic UI antd gives every
// Typography its `-rtl` class (`.ant-typography-rtl { direction: rtl }`), and any author rule beats the attribute, so a
// `dir="ltr"` there does nothing — a code or a key that starts with a sign (`+966…`, `-5`, `#A1`) showed the sign at the
// wrong end (KI-093, KI-110). A left-to-right value goes in a plain `<bdi dir="ltr">` inside the Typography (a block of
// English text in a `<div dir="ltr">`), which no antd class reaches.
//
// jsdom lays nothing out, so this reads the files: every `<Typography.X …>` and every destructured `<Text|Paragraph|Title …>`
// opening tag of src/**/*.tsx, over several lines too, read up to its own `>` — never the `>` of an arrow function, a
// nested element or a comparison inside an attribute expression.
import { describe, expect, it } from 'vitest'

interface NodeFs {
  readdirSync: (path: URL, options: { withFileTypes: true }) => { name: string; isDirectory: () => boolean }[]
  readFileSync: (path: URL, encoding: 'utf8') => string
}

/**
 * Tags left on purpose, by file (path below src/) and count: pages/CoursesPage.tsx belongs to the third developer's open
 * PR #193 (the /courses table at 390 px), which this batch does not touch; remove the entry once its code moves into a
 * `<bdi dir="ltr">` there.
 */
const KNOWN: Readonly<Record<string, number>> = { 'pages/CoursesPage.tsx': 1 }

async function nodeFs(): Promise<NodeFs> {
  const fsModule = 'node:fs'
  return (await import(/* @vite-ignore */ fsModule)) as NodeFs
}

/** The .tsx files below `dir`, as paths relative to src/. */
function sourcesOf(fs: NodeFs, dir: URL, prefix = ''): string[] {
  const files: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) files.push(...sourcesOf(fs, new URL(`${entry.name}/`, dir), `${prefix}${entry.name}/`))
    else if (entry.name.endsWith('.tsx')) files.push(`${prefix}${entry.name}`)
  }
  return files
}

/** The index just past the string or template literal that opens at `start` (its quote), escapes and `${…}` included. */
function skipQuoted(source: string, start: number): number {
  const quote = source[start]!
  for (let index = start + 1; index < source.length; index += 1) {
    const char = source[index]
    if (char === '\\') index += 1
    else if (char === quote) return index + 1
    else if (quote === '`' && char === '$' && source[index + 1] === '{') index = skipBraces(source, index + 1) - 1
  }
  return source.length
}

/** The index just past the `}` that closes the `{` at `start`, strings, templates and nested braces skipped. */
function skipBraces(source: string, start: number): number {
  let depth = 0
  for (let index = start; index < source.length; index += 1) {
    const char = source[index]
    if (char === '"' || char === "'" || char === '`') {
      index = skipQuoted(source, index) - 1
    } else if (char === '{') {
      depth += 1
    } else if (char === '}') {
      depth -= 1
      if (depth === 0) return index + 1
    }
  }
  return source.length
}

/**
 * The attributes of the opening tag whose name ends at `start`, up to the tag's own `>`: an expression in braces (an arrow
 * function's `=>`, a nested object, a JSX element, a template) and a quoted value are skipped whole. Returns the
 * attribute text with every expression and quoted value emptied (`{}`, `""`), so only attribute names are read, and the
 * index of the closing `>`.
 */
function openingTag(source: string, start: number): { names: string; end: number } {
  let names = ''
  for (let index = start; index < source.length; index += 1) {
    const char = source[index]!
    if (char === '{') {
      index = skipBraces(source, index) - 1
      names += '{}'
    } else if (char === '"' || char === "'") {
      index = skipQuoted(source, index) - 1
      names += '""'
    } else if (char === '>') {
      return { names, end: index }
    } else {
      names += char
    }
  }
  return { names, end: source.length }
}

/** The opening tags of a Typography component that carry a `dir` attribute, as `line: tag`. */
function typographyWithDir(source: string): string[] {
  const found: string[] = []
  for (const match of source.matchAll(/<(Typography\.\w+|Text|Paragraph|Title)\b/g)) {
    const { names, end } = openingTag(source, match.index + match[0].length)
    if (!/(^|\s)dir=/.test(names)) continue
    const line = source.slice(0, match.index).split('\n').length
    found.push(`${line}: ${source.slice(match.index, end + 1).replace(/\s+/g, ' ')}`)
  }
  return found
}

describe('Typography never carries dir (KI-120)', () => {
  it('finds a dir on a Typography, on one line or across several, and leaves a plain <bdi dir="ltr"> alone', () => {
    expect(typographyWithDir('<Typography.Text dir="ltr" strong>{code}</Typography.Text>')).toHaveLength(1)
    expect(typographyWithDir('<Typography.Text\n  type="secondary"\n  dir="ltr"\n>\n  {email}\n</Typography.Text>')).toHaveLength(1)
    expect(typographyWithDir('<Typography.Link href={url} dir="ltr">{url}</Typography.Link>')).toHaveLength(1)
    expect(typographyWithDir('<Text code dir="ltr">{key}</Text>')).toHaveLength(1)
    expect(typographyWithDir('<Typography.Text strong>\n  <bdi dir="ltr">{code}</bdi>\n</Typography.Text>')).toEqual([])
    expect(typographyWithDir('<span dir="ltr">{range}</span>')).toEqual([])
  })

  it('reads a tag up to its own `>`, past the `>` of an arrow function, a comparison, a nested element, a nested object and a template (review of KI-120)', () => {
    expect(typographyWithDir('<Typography.Link onClick={() => go()} dir="ltr">{url}</Typography.Link>')).toHaveLength(1)
    expect(typographyWithDir('<Typography.Text type={count > 0 ? "danger" : undefined} dir="ltr">{n}</Typography.Text>')).toHaveLength(1)
    expect(typographyWithDir('<Typography.Text title={<span>a</span>} dir="ltr">{n}</Typography.Text>')).toHaveLength(1)
    expect(typographyWithDir('<Typography.Text style={{ margin: { top: 0 } }}\n  copyable={{ text: code, tooltips: ["a", "b"] }}\n  dir="ltr"\n>\n  {code}\n</Typography.Text>')).toHaveLength(1)
    expect(typographyWithDir('<Text title={`${a} > ${b ? "}" : "{"}`} dir="ltr">{n}</Text>')).toHaveLength(1)
    // A `dir=` inside an expression or a quoted value is no attribute of the Typography.
    expect(typographyWithDir('<Typography.Text title="dir=ltr" onClick={() => setProps({ dir: "ltr" })}>{n}</Typography.Text>')).toEqual([])
    expect(typographyWithDir('<Typography.Text icon={<span dir="ltr">+1</span>}>{n}</Typography.Text>')).toEqual([])
  })

  it('has no Typography with a dir attribute in src/**/*.tsx', async () => {
    const fs = await nodeFs()
    // A variable, not a literal: Vite rewrites `new URL('./', import.meta.url)` into a served URL.
    const here = './'
    const src = new URL(here, import.meta.url)
    const offenders: string[] = []
    const files = sourcesOf(fs, src)
    // The walk really reads the tree (a screen with a code column among them).
    expect(files).toContain('pages/ClassesPage.tsx')
    for (const file of files) {
      const found = typographyWithDir(fs.readFileSync(new URL(file, src), 'utf8'))
      if (found.length > (KNOWN[file] ?? 0)) offenders.push(...found.map((tag) => `${file}:${tag}`))
    }
    expect(offenders).toEqual([])
  })
})
