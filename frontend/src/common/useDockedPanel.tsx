// A list page's side panel (redesign, 2026-11-14): on a wide screen the record opens in a panel beside the table
// instead of a drawer over it. The page renders `<aside ref={panelRef} className="list-panel" />` next to its
// table inside `.list-with-panel` (index.css); the record's drawer spreads `dockedDrawerProps()` and reports its
// unsaved work through `onUnsavedChange`, so switching to another record asks the drawers' own question first.
import { App } from 'antd'
import type { DrawerProps } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMediaQuery } from './useMediaQuery'

/** From this width a record docks beside its list; below it the drawer opens over the page as before. */
export const DOCK_QUERY = '(min-width: 1360px)'

export interface DockedPanel {
  /** The panel is on screen: wide enough and a record is open. */
  docked: boolean
  /** The panel element to dock the drawer in, while docked. */
  dockedIn: HTMLElement | undefined
  /** Ref of the `<aside className="list-panel">`, rendered only while `wide`. */
  panelRef: (element: HTMLElement | null) => void
  wide: boolean
  /** For the drawer: whether it holds unsaved work now. */
  onUnsavedChange: (unsaved: boolean) => void
  /** Opens a record; leaving one that holds unsaved work asks `common.unsaved.*` first. */
  open: (id: string) => void
  /** The wrapper's class: the grid widens to two columns while docked. */
  layoutClassName: string
}

export function useDockedPanel(selectedId: string | null, select: (id: string) => void): DockedPanel {
  const { t } = useTranslation()
  const { modal } = App.useApp()
  const wide = useMediaQuery(DOCK_QUERY)
  const [panel, setPanel] = useState<HTMLElement | null>(null)
  const [unsaved, setUnsaved] = useState(false)
  const onUnsavedChange = useCallback((value: boolean) => setUnsaved(value), [])
  const docked = wide && selectedId !== null

  // The panel sticks 80px below the top, but before the page scrolls it starts lower (under the page title), so a
  // fixed `100vh - 96px` ran past the bottom of the window and hid the drawer's footer (the attendance save bar).
  // Its height follows where it actually starts: from its top to 16px above the window's bottom.
  useEffect(() => {
    if (!docked || !panel) return
    const fit = () => {
      const top = Math.max(0, panel.getBoundingClientRect().top)
      document.documentElement.style.setProperty('--list-panel-height', `${Math.max(320, window.innerHeight - top - 16)}px`)
    }
    fit()
    window.addEventListener('scroll', fit, { passive: true })
    window.addEventListener('resize', fit)
    return () => {
      window.removeEventListener('scroll', fit)
      window.removeEventListener('resize', fit)
      document.documentElement.style.removeProperty('--list-panel-height')
    }
  }, [docked, panel])

  const open = (id: string) => {
    if (selectedId && id !== selectedId && unsaved) {
      modal.confirm({
        title: t('common.unsaved.title'),
        content: t('common.unsaved.content'),
        okText: t('common.unsaved.ok'),
        cancelText: t('common.unsaved.cancel'),
        onOk: () => {
          setUnsaved(false)
          select(id)
        },
      })
      return
    }
    select(id)
  }

  return {
    docked,
    dockedIn: docked && panel ? panel : undefined,
    panelRef: setPanel,
    wide,
    onUnsavedChange,
    open,
    layoutClassName: docked ? 'list-with-panel list-with-panel--open' : 'list-with-panel',
  }
}

/**
 * The Drawer props of a docked record: inside the panel, no mask, the panel's full size. Without a panel the
 * drawer keeps its own mask (with `closable` off while unsaved — KI-052) and size.
 */
export function dockedDrawerProps(dockedIn: HTMLElement | undefined | null, unsaved: boolean, size: DrawerProps['size']): Partial<DrawerProps> {
  if (!dockedIn) return { mask: { closable: !unsaved }, size }
  return { mask: false, getContainer: dockedIn, rootClassName: 'record-drawer--docked', size: '100%' }
}
