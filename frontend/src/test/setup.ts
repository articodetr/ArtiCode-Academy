// Runs before every test file (vite.config.ts → test.setupFiles).
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
// The real translations, exactly as main.tsx loads them: Arabic default, RTL document.
import '../i18n'

// Testing Library only cleans up by itself when the test globals are injected;
// this project imports `describe`/`it` explicitly, so unmount after each test here.
afterEach(() => {
  cleanup()
})

// jsdom logs "Not implemented: getComputedStyle() with pseudo-elements" when Ant
// Design asks for ::before/::after styles (wave/motion). Ignore the pseudo-element
// argument instead of letting every run print that line.
const getComputedStyle = window.getComputedStyle.bind(window)
window.getComputedStyle = (element: Element) => getComputedStyle(element)

// jsdom has no matchMedia; Ant Design's responsive observer (Row/Col behind
// Form.Item, Table) calls it on mount. A query that never matches is enough.
if (typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  })
}
