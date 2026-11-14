// Names for unlabelled drop-downs (redesign, quality pass). The list pages filter with antd Selects that show a
// placeholder («all courses», «all statuses») and no visible label; the combobox inside then has no accessible
// name (axe `label`), and a screen reader announces only «combobox». Rather than add an aria-label to some forty
// filters by hand, this watches the page and gives such a combobox its own placeholder text as its name. A
// combobox with a <label>, aria-label or aria-labelledby is left alone; the name follows the placeholder when the
// language changes (the text is read again on every mutation).
const OWNED = 'data-placeholder-label'

function nameUnlabelled(root: ParentNode): void {
  for (const input of root.querySelectorAll<HTMLInputElement>('.ant-select input[role="combobox"]')) {
    const owned = input.hasAttribute(OWNED)
    if (!owned && (input.labels?.length || input.getAttribute('aria-labelledby') || input.getAttribute('aria-label'))) continue
    const placeholder = input.closest('.ant-select')?.querySelector('.ant-select-placeholder')?.textContent?.trim()
    const name = placeholder || (owned ? input.getAttribute('aria-label') : null)
    if (!name) continue
    if (input.getAttribute('aria-label') !== name) input.setAttribute('aria-label', name)
    input.setAttribute(OWNED, '')
  }
}

/** Starts watching the document; returns the function that stops it. */
export function labelUnlabelledSelects(): () => void {
  if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return () => {}
  let queued = false
  const run = () => {
    queued = false
    nameUnlabelled(document)
  }
  const observer = new MutationObserver(() => {
    if (queued) return
    queued = true
    requestAnimationFrame(run)
  })
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  run()
  return () => observer.disconnect()
}
