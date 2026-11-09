// A data router for the tests of the unsaved-work guard (J-F27, KI-055): react-router's
// useBlocker works under createMemoryRouter + RouterProvider only, and NavigationBlocker
// renders nothing under the <MemoryRouter> of renderWithProviders. Same providers
// otherwise (Ant Design in RTL, the fake auth context), in the order of src/app/App.tsx.
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import type { RenderResult } from '@testing-library/react'
import { App as AntdApp, ConfigProvider } from 'antd'
import arEG from 'antd/locale/ar_EG'
import type { ReactElement } from 'react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { AuthContext } from '../auth/auth-context'
import type { AuthContextValue } from '../auth/auth-context'
import { ar } from '../i18n/ar'
import { LocationProbe } from './LocationProbe'
import { makeAuth } from './render'

export type DataRouter = ReturnType<typeof createMemoryRouter>

export interface RenderInDataRouterOptions {
  /** Auth state seen by `useAuth()`; defaults to an anonymous visitor. */
  auth?: AuthContextValue
  /** The route that mounts `ui` — the current (second) history entry. */
  path?: string
  /** The first history entry, where a browser back lands: it shows a LocationProbe. */
  previous?: string
}

/**
 * Renders `ui` at `path` in a memory data router whose history holds `previous` then
 * `path`, so `goBack(router)` is the browser's back button. Returns the router too.
 */
export function renderInDataRouter(
  ui: ReactElement,
  { auth = makeAuth(), path = '/page', previous = '/' }: RenderInDataRouterOptions = {},
): RenderResult & { router: DataRouter } {
  const router = createMemoryRouter(
    [
      { path: previous, element: <LocationProbe /> },
      { path, element: ui },
    ],
    { initialEntries: [previous, path], initialIndex: 1 },
  )
  const result = render(
    <ConfigProvider direction="rtl" locale={arEG}>
      <AntdApp>
        <AuthContext value={auth}>
          <RouterProvider router={router} />
        </AuthContext>
      </AntdApp>
    </ConfigProvider>,
  )
  return { ...result, router }
}

/** The browser's back button: one history entry back (a POP navigation, as popstate gives it). */
export async function goBack(router: DataRouter) {
  await act(async () => {
    await router.navigate(-1)
  })
}

/** What a reload or a tab close sends first; true when a listener asked the browser to prompt. */
export function unloadWouldPrompt(): boolean {
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  return event.defaultPrevented
}

/** The states of the router's blockers — 'unblocked' again once a held navigation is answered. */
export function blockerStates(router: DataRouter): string[] {
  return [...router.state.blockers.values()].map((blocker) => blocker.state)
}

/**
 * How many «discard?» questions (common.unsaved.*) are in the document — an answered one
 * lingers in jsdom. Dialogs are counted: an antd 6 confirm shows its title twice (the
 * modal header and the confirm body).
 */
export function discardQuestionCount(): number {
  return new Set(screen.queryAllByText(ar.common.unsaved.title).map((title) => title.closest('[role="dialog"]'))).size
}

/** The latest «discard?» question: jsdom never ends the closing animation of an answered one. */
export async function latestDiscardQuestion(): Promise<HTMLElement> {
  const titles = await screen.findAllByText(ar.common.unsaved.title)
  return titles[titles.length - 1]!.closest('[role="dialog"]') as HTMLElement
}

/** Answers a «discard?» question; a navigation it lets go on completes inside `act`. */
export async function answerDiscardQuestion(dialog: HTMLElement, answer: 'discard' | 'keep') {
  const label = answer === 'discard' ? ar.common.unsaved.ok : ar.common.unsaved.cancel
  await act(async () => {
    fireEvent.click(within(dialog).getByText(label).closest('button')!)
  })
}
