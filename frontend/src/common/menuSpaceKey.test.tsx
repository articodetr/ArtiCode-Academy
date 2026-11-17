import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Button, Dropdown, Menu, Modal } from 'antd'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installMenuSpaceActivation } from './menuSpaceKey'

let uninstall: (() => void) | null = null

afterEach(() => {
  uninstall?.()
  uninstall = null
})

/** An antd menu with an enabled item «أ» and a disabled item «ب», each reporting its clicks to `onClick`. */
function renderMenu(onClick = vi.fn()) {
  render(
    <Menu
      items={[
        { key: 'a', label: 'أ', onClick: ({ key, domEvent }) => onClick(key, domEvent.type) },
        { key: 'b', label: 'ب', disabled: true, onClick: ({ key, domEvent }) => onClick(key, domEvent.type) },
      ]}
    />,
  )
  const item = (label: string) => screen.getByText(label).closest('li') as HTMLElement
  return { onClick, item }
}

const space = { key: ' ', code: 'Space', keyCode: 32, which: 32 }
const enter = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13 }

/** An actions dropdown whose item opens a confirmation — the shape of every action menu of the app. */
function ConfirmingActions({ onCancel }: { onCancel: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Dropdown trigger={['click']} destroyOnHidden menu={{ items: [{ key: 'archive', label: 'أرشفة الفصل' }], onClick: () => setOpen(true) }}>
        <Button>إجراءات الفصل</Button>
      </Dropdown>
      <Modal
        open={open}
        title="تأكيد الأرشفة"
        onOk={() => setOpen(false)}
        onCancel={() => {
          onCancel()
          setOpen(false)
        }}
      >
        سيُؤرشف الفصل.
      </Modal>
    </>
  )
}

/**
 * One press of Enter as a browser runs it; jsdom dispatches the keydown alone. Unless the keydown was cancelled, a
 * keypress follows, aimed at the element focused by then — the dialog the item opened, whose close button had the
 * focus in the real browser (KI-089; jsdom moves no focus into it, so the test does) — and the keypress of Enter on a
 * focused button presses it.
 */
function pressEnterLikeABrowser(item: HTMLElement) {
  const keydownGoesOn = fireEvent.keyDown(item, enter)
  document.querySelector<HTMLButtonElement>('.ant-modal-close')?.focus()
  const focused = document.activeElement as HTMLElement
  if (keydownGoesOn && fireEvent.keyPress(focused, { ...enter, charCode: 13 }) && focused instanceof HTMLButtonElement) focused.click()
  fireEvent.keyUp(focused, enter)
}

describe('installMenuSpaceActivation (KI-108, KI-089)', () => {
  it('picks a focused menu item with Space on the key’s release, through the menu’s own click path, and cancels the keydown', () => {
    uninstall = installMenuSpaceActivation()
    const { onClick, item } = renderMenu()
    const a = item('أ')
    expect(a).toHaveAttribute('role', 'menuitem')
    a.focus()

    // `fireEvent` returns false when the event was cancelled: no page scroll, no keypress.
    expect(fireEvent.keyDown(a, space)).toBe(false)
    expect(onClick).not.toHaveBeenCalled()
    expect(fireEvent.keyUp(a, space)).toBe(false)
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(onClick).toHaveBeenCalledWith('a', 'click')
  })

  it('leaves the pick of Enter and of the mouse to the menu: one pick each, never a second one', () => {
    uninstall = installMenuSpaceActivation()
    const { onClick, item } = renderMenu()
    const a = item('أ')
    a.focus()

    fireEvent.keyDown(a, enter)
    fireEvent.keyUp(a, enter)
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(onClick).toHaveBeenLastCalledWith('a', 'keydown')

    fireEvent.click(a)
    expect(onClick).toHaveBeenCalledTimes(2)
    expect(onClick).toHaveBeenLastCalledWith('a', 'click')
  })

  it('cancels the keydown of Enter on an enabled menu item after the menu picked the item — never before it (KI-089)', () => {
    uninstall = installMenuSpaceActivation()
    const seen: boolean[] = []
    render(
      <Menu
        items={[
          { key: 'a', label: 'أ', onClick: ({ domEvent }) => seen.push(domEvent.defaultPrevented) },
          { key: 'b', label: 'ب', disabled: true },
        ]}
      />,
    )
    const a = screen.getByText('أ').closest('li') as HTMLElement
    a.focus()

    // `fireEvent` returns false when the event was cancelled — which, in a browser, cancels the keypress after it.
    expect(fireEvent.keyDown(a, enter)).toBe(false)
    // The menu's own handler ran first and saw an event nobody had cancelled yet: the guard is in the bubble phase.
    expect(seen).toEqual([false])
    // With a modifier or held down the menu still picks on Enter, so the keypress is cancelled too.
    expect(fireEvent.keyDown(a, { ...enter, shiftKey: true })).toBe(false)
    expect(fireEvent.keyDown(a, { ...enter, repeat: true })).toBe(false)
    expect(seen).toEqual([false, false, false])

    // A disabled item, a composition and anything that is not a menu item keep their Enter.
    expect(fireEvent.keyDown(screen.getByText('ب').closest('li') as HTMLElement, enter)).toBe(true)
    expect(fireEvent.keyDown(a, { ...enter, isComposing: true })).toBe(true)
    const outside = document.createElement('button')
    document.body.append(outside)
    expect(fireEvent.keyDown(outside, enter)).toBe(true)
    outside.remove()
  })

  it('keeps a confirmation that an action opens with Enter open: a real dropdown whose item opens a modal (KI-089)', async () => {
    uninstall = installMenuSpaceActivation()
    const onCancel = vi.fn()
    render(<ConfirmingActions onCancel={onCancel} />)
    fireEvent.click(screen.getByText('إجراءات الفصل').closest('button')!)
    const action = (await screen.findByText('أرشفة الفصل')).closest('li') as HTMLElement
    action.focus()
    pressEnterLikeABrowser(action)

    expect(await screen.findByText('سيُؤرشف الفصل.')).toBeInTheDocument()
    // The keypress of that same Enter never reached the dialog's close button.
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('does nothing for a disabled item, a key held down, a modifier, or a release on another element', () => {
    uninstall = installMenuSpaceActivation()
    const { onClick, item } = renderMenu()
    const a = item('أ')

    expect(fireEvent.keyDown(item('ب'), space)).toBe(true)
    fireEvent.keyUp(item('ب'), space)

    fireEvent.keyDown(a, { ...space, ctrlKey: true })
    fireEvent.keyUp(a, space)

    // The key went down on the item and came up elsewhere (the focus moved): no pick.
    fireEvent.keyDown(a, space)
    fireEvent.keyUp(document.body, space)
    fireEvent.keyUp(a, space)

    // A repeat alone (no first press on the item) picks nothing either.
    fireEvent.keyDown(a, { ...space, repeat: true })
    fireEvent.keyUp(a, space)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('is removed by the function it returns', () => {
    const { onClick, item } = renderMenu()
    installMenuSpaceActivation()()
    const a = item('أ')
    expect(fireEvent.keyDown(a, space)).toBe(true)
    fireEvent.keyUp(a, space)
    expect(onClick).not.toHaveBeenCalled()
    expect(fireEvent.keyDown(a, enter)).toBe(true)
  })

  it('picks a dropdown’s action with Space and closes the dropdown, as a click does', async () => {
    uninstall = installMenuSpaceActivation()
    const onAction = vi.fn()
    const onOpenChange = vi.fn()
    render(
      <Dropdown trigger={['click']} onOpenChange={onOpenChange} menu={{ items: [{ key: 'suspend', label: 'إيقاف الحساب' }], onClick: ({ key }) => onAction(key) }}>
        <Button>الإجراءات</Button>
      </Dropdown>,
    )
    fireEvent.click(screen.getByText('الإجراءات').closest('button')!)
    const action = (await screen.findByText('إيقاف الحساب')).closest('li') as HTMLElement
    action.focus()
    fireEvent.keyDown(action, space)
    fireEvent.keyUp(action, space)
    expect(onAction).toHaveBeenCalledWith('suspend')
    await waitFor(() => expect(onOpenChange).toHaveBeenLastCalledWith(false, expect.anything()))
  })
})
