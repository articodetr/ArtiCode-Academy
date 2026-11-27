import { describe, expect, it } from 'vitest'
import { courseTextBlocks, runsOf } from './courseText'

describe('courseTextBlocks', () => {
  it('keeps a plain text as one paragraph, its line breaks as lines', () => {
    expect(courseTextBlocks('سطر أول\nسطر ثانٍ')).toEqual([
      {
        kind: 'paragraph',
        lines: [[{ text: 'سطر أول', strong: false }], [{ text: 'سطر ثانٍ', strong: false }]],
      },
    ])
  })

  it('reads a bold line as a heading and «- » lines as a list', () => {
    const blocks = courseTextBlocks('تهدف هذه الدورة إلى التعريف بالإلكترونيات.\n**ماذا ستتعلم في هذه الدورة؟**\n- أساسيات الكهرباء\n- المقاومة')
    expect(blocks.map((block) => block.kind)).toEqual(['paragraph', 'heading', 'list'])
    expect(blocks[1]).toEqual({ kind: 'heading', runs: [{ text: 'ماذا ستتعلم في هذه الدورة؟', strong: false }] })
    expect(blocks[2]).toEqual({
      kind: 'list',
      ordered: false,
      items: [[{ text: 'أساسيات الكهرباء', strong: false }], [{ text: 'المقاومة', strong: false }]],
    })
  })

  it('reads numbered lines (Latin or Arabic-Indic digits) as an ordered list and # lines as a heading', () => {
    const blocks = courseTextBlocks('## المحاور\n1. الأول\n٢) الثاني')
    expect(blocks).toEqual([
      { kind: 'heading', runs: [{ text: 'المحاور', strong: false }] },
      { kind: 'list', ordered: true, items: [[{ text: 'الأول', strong: false }], [{ text: 'الثاني', strong: false }]] },
    ])
  })

  it('ends a paragraph or a list at a blank line, and starts a new list when the kind changes', () => {
    const blocks = courseTextBlocks('- أ\n1. ب\n\nفقرة')
    expect(blocks.map((block) => (block.kind === 'list' ? `list:${block.ordered}` : block.kind))).toEqual(['list:false', 'list:true', 'paragraph'])
  })

  it('returns nothing for blank text', () => {
    expect(courseTextBlocks('  \n\n ')).toEqual([])
  })
})

describe('runsOf', () => {
  it('marks the text between a pair of ** as strong and keeps an unpaired ** as typed', () => {
    expect(runsOf('اقرأ **هذا** أولاً')).toEqual([
      { text: 'اقرأ ', strong: false },
      { text: 'هذا', strong: true },
      { text: ' أولاً', strong: false },
    ])
    expect(runsOf('سعر **خاص')).toEqual([{ text: 'سعر **خاص', strong: false }])
  })

  it('never reads HTML: a tag stays text', () => {
    expect(runsOf('<b>x</b>')).toEqual([{ text: '<b>x</b>', strong: false }])
  })
})
