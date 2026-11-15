// The record panel of a list page, in the original layout (no docking): the pages ported from the redesign branch
// (payments, announcements) call this hook, and here it always opens the record in antd's own drawer over the
// page. It still asks before switching records while the open one holds unsaved work.
import { App } from 'antd'
import type { DrawerProps } from 'antd'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

export interface DockedPanel {
  /** Always false here: the record opens in a drawer over the page. */
  docked: boolean
  dockedIn: HTMLElement | undefined
  panelRef: (element: HTMLElement | null) => void
  wide: boolean
  onUnsavedChange: (unsaved: boolean) => void
  open: (id: string) => void
  layoutClassName: string
}

const noPanel = () => {}

export function useDockedPanel(selectedId: string | null, select: (id: string) => void): DockedPanel {
  const { t } = useTranslation()
  const { modal } = App.useApp()
  const [unsaved, setUnsaved] = useState(false)
  const onUnsavedChange = useCallback((value: boolean) => setUnsaved(value), [])

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

  return { docked: false, dockedIn: undefined, panelRef: noPanel, wide: false, onUnsavedChange, open, layoutClassName: '' }
}

/** The Drawer props of a record: its own mask (not closable while unsaved — KI-052) and size. */
export function dockedDrawerProps(_dockedIn: HTMLElement | undefined | null, unsaved: boolean, size: DrawerProps['size']): Partial<DrawerProps> {
  return { mask: { closable: !unsaved }, size }
}
