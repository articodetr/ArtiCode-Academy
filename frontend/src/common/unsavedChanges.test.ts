// KI-055 (J-F27): the pure parts of the drawers' unsaved-work guard — the
// `beforeunload` listener and the one «discard?» question that the close button and a
// navigation held by the router blocker share.
import { describe, expect, it, vi } from 'vitest'
import { createDiscardQuestion, preventUnload } from './unsavedChanges'
import type { BlockedNavigation, DiscardAnswers } from './unsavedChanges'

describe('preventUnload', () => {
  it('asks the browser to prompt: default prevented, and a returnValue for older browsers', () => {
    const event = { preventDefault: vi.fn(), returnValue: undefined as unknown }
    preventUnload(event as unknown as BeforeUnloadEvent)
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(event.returnValue).toBe('')
  })
})

/** A question whose screen is a list: every `open` pushes its answers and a take-down spy. */
function setUp() {
  const shown: { answers: DiscardAnswers; takeDown: ReturnType<typeof vi.fn> }[] = []
  const discard = vi.fn()
  const question = createDiscardQuestion({
    open: (answers) => {
      const takeDown = vi.fn()
      shown.push({ answers, takeDown })
      return takeDown
    },
    discard,
  })
  return { question, shown, discard }
}

/** A held navigation that records the order of its calls (with the discard spy's). */
function navigation(log: string[], name = 'navigation'): BlockedNavigation {
  return { proceed: vi.fn(() => log.push(`${name}.proceed`)), reset: vi.fn(() => log.push(`${name}.reset`)) }
}

describe('createDiscardQuestion', () => {
  it('asks once for the close button: a second request while it is on screen opens nothing', () => {
    const { question, shown, discard } = setUp()
    question.ask()
    question.ask()
    expect(shown).toHaveLength(1)

    shown[0]!.answers.discard()
    expect(discard).toHaveBeenCalledTimes(1)
    // Answered: the next request asks again.
    question.ask()
    expect(shown).toHaveLength(2)
  })

  it('keeps the work on «keep editing»: nothing is dropped, and the next request asks again', () => {
    const { question, shown, discard } = setUp()
    question.ask()
    shown[0]!.answers.keep()
    expect(discard).not.toHaveBeenCalled()
    question.ask()
    expect(shown).toHaveLength(2)
  })

  it('asks for a held navigation: «discard» lets it go on first, then drops the work', () => {
    const { question, shown, discard } = setUp()
    const log: string[] = []
    discard.mockImplementation(() => log.push('discard'))
    const held = navigation(log)
    question.hold(held)
    expect(shown).toHaveLength(1)

    shown[0]!.answers.discard()
    expect(log).toEqual(['navigation.proceed', 'discard'])
    expect(held.reset).not.toHaveBeenCalled()
  })

  it('cancels a held navigation on «keep editing» and keeps the work', () => {
    const { question, shown, discard } = setUp()
    const log: string[] = []
    const held = navigation(log)
    question.hold(held)
    shown[0]!.answers.keep()
    expect(log).toEqual(['navigation.reset'])
    expect(discard).not.toHaveBeenCalled()
  })

  it('lets a navigation held while the close button asks join that question instead of asking again', () => {
    const { question, shown, discard } = setUp()
    const log: string[] = []
    discard.mockImplementation(() => log.push('discard'))
    question.ask()
    question.hold(navigation(log))
    expect(shown).toHaveLength(1)

    shown[0]!.answers.discard()
    expect(log).toEqual(['navigation.proceed', 'discard'])
  })

  it('answers the latest navigation only when the router holds a newer one (a second back press)', () => {
    const { question, shown } = setUp()
    const log: string[] = []
    question.hold(navigation(log, 'first'))
    question.hold(navigation(log, 'second'))
    expect(shown).toHaveLength(1)
    shown[0]!.answers.keep()
    expect(log).toEqual(['second.reset'])
  })

  it('forgets a navigation the blocker no longer holds: «discard» then only drops the work', () => {
    const { question, shown, discard } = setUp()
    const log: string[] = []
    discard.mockImplementation(() => log.push('discard'))
    question.hold(navigation(log))
    question.hold(null)
    // Nothing held: no new question either.
    expect(shown).toHaveLength(1)
    shown[0]!.answers.discard()
    expect(log).toEqual(['discard'])
  })

  it('ignores a late or repeated answer once the question is settled', () => {
    const { question, shown, discard } = setUp()
    const log: string[] = []
    question.hold(navigation(log))
    shown[0]!.answers.keep()
    shown[0]!.answers.discard()
    shown[0]!.answers.keep()
    expect(log).toEqual(['navigation.reset'])
    expect(discard).not.toHaveBeenCalled()
  })

  it('takes a question on screen down unanswered when disposed, and asks afresh afterwards', () => {
    const { question, shown, discard } = setUp()
    const log: string[] = []
    question.hold(navigation(log))
    question.dispose()
    expect(shown[0]!.takeDown).toHaveBeenCalledTimes(1)
    // Its answers come too late: nothing proceeds, resets or drops.
    shown[0]!.answers.discard()
    expect(log).toEqual([])
    expect(discard).not.toHaveBeenCalled()

    question.dispose()
    expect(shown[0]!.takeDown).toHaveBeenCalledTimes(1)
    question.ask()
    expect(shown).toHaveLength(2)
  })
})
