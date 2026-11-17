// The keyboard of an Ant Design menu — a dropdown's actions (the user drawer's account actions, the class, course,
// lesson, assignment, exam and enrollment actions, …) or the side menu.
//
// Space picks a focused item, as Enter and a click already do (KI-108). @rc-component/menu (MenuItem.js) acts on
// Enter only, and a focused <li role="menuitem"> is no button: Space scrolled the page and picked nothing.
// The keydown of Space on a menu item is cancelled — no scroll and no keypress — and its keyup clicks that same item,
// so the menu runs its own click path (the item's onClick, then the dropdown closes). On the keyup, as a native button
// does: the dialog an item opens is mounted after the key is released and never receives a key event of the press
// that opened it.
//
// Enter keeps the menu's own pick, made on the keydown (KI-089): when the item's onClick opens a dialog, the dialog
// takes the focus during that keydown, and the keypress the browser dispatches next for the same press landed on the
// dialog's focused button (its close button) — the confirmation closed itself at once. The keydown of Enter on a menu
// item is cancelled AFTER the menu picked the item (this listener is on the document, in the bubble phase; React's
// own listener sits below it, on its root or on the portal's container), which cancels that keypress and nothing
// else: an Enter on a menu item has no other default action. CH-0294 fixed it in UserStatusActions alone; this covers
// every menu.
//
// One listener on the document, installed once by AppLayout (every menu of the app is mounted under it; a dropdown's
// popup is portalled to <body>, still inside the document). An item that is disabled, a Space held down (repeat), a
// modifier with Space or a composition is left alone.

const SPACE = ' '
const ENTER = 'Enter'

/** The menu item the event is on: an enabled `<li role="menuitem">` of a `role="menu"` list, else null. */
function menuItemOf(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof HTMLElement) || !target.matches('li[role="menuitem"]')) return null
  if (target.getAttribute('aria-disabled') === 'true') return null
  return target.closest('[role="menu"]') ? target : null
}

/** Installs the Space activation and the Enter guard on `root`; returns the function that removes them. */
export function installMenuSpaceActivation(root: Document = document): () => void {
  let pressed: HTMLElement | null = null

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === ENTER) {
      // The menu has already picked the item (it acts on Enter whatever the modifiers or a repeat): only the keypress
      // that would follow is cancelled.
      if (!event.isComposing && menuItemOf(event.target)) event.preventDefault()
      return
    }
    if (event.key !== SPACE || event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return
    const item = menuItemOf(event.target)
    if (!item) return
    event.preventDefault()
    if (!event.repeat) pressed = item
  }

  const onKeyUp = (event: KeyboardEvent) => {
    if (event.key !== SPACE) return
    const item = pressed
    pressed = null
    // Only the item the key went down on, still focused when it comes up.
    if (!item || event.target !== item) return
    event.preventDefault()
    item.click()
  }

  // Bubble phase (not capture): the Enter guard must run after the menu's own keydown handler.
  root.addEventListener('keydown', onKeyDown)
  root.addEventListener('keyup', onKeyUp)
  return () => {
    root.removeEventListener('keydown', onKeyDown)
    root.removeEventListener('keyup', onKeyUp)
  }
}
