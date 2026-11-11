// KI-060: antd draws a drawer's mask and its panel (the header with the close
// button, the body and anything rendered inside the <Drawer>, such as an action
// dialog) through rc-motion's CSSMotion. @rc-component/motion 1.3.3 keeps the
// element it rendered while its `styleReady` is false (a useMemo keyed on a
// counter that moves only when it is true). jsdom never fires `transitionend`,
// so the opening motion ends on antd's 500 ms deadline; from then until the step
// queue reaches STEP_ACTIVATED two animation frames later, `styleReady` stays
// false. A re-render in that gap does not reach the mask or the panel: the mask
// keeps its old `onClick` (a drawer that has just begun to hold unsaved work
// then closes as if it held none) and a dialog drawn inside the drawer shows
// late. The gap is short, but under load the test lands in it. Escape is not
// affected (rc-portal calls the drawer's latest handler). The element keeps its
// motion classes until the gap ends, so a test waits for them to go.
import { fireEvent, waitFor } from '@testing-library/react'

const MOVING = '.ant-drawer-mask[class*="-motion"], .ant-drawer-content-wrapper[class*="-motion"]'

/** Resolves once no drawer's mask or panel is in a motion, opening or closing (KI-060). */
export async function waitForDrawersToSettle(): Promise<void> {
  await waitFor(
    () => {
      const moving = document.querySelector(MOVING)
      if (moving) throw new Error(`a drawer is still moving: ${moving.className}`)
    },
    { timeout: 10_000 },
  )
}

/** Clicks the element (a drawer's mask or close button) once every drawer has settled (KI-060). */
export async function clickWhenSettled(target: () => Element): Promise<void> {
  await waitForDrawersToSettle()
  fireEvent.click(target())
}
