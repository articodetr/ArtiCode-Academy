// A readable name for a signed-in device from its User-Agent header (CH-0265): the browser and the system, or
// null when the header says neither. Only common browsers and systems are named; nothing else is guessed.

const BROWSERS: ReadonlyArray<[RegExp, string]> = [
  [/\bEdg(?:e|A|iOS)?\//, 'Edge'],
  [/\bOPR\/|\bOpera\b/, 'Opera'],
  [/\bSamsungBrowser\//, 'Samsung Internet'],
  [/\bFirefox\/|\bFxiOS\//, 'Firefox'],
  [/\bChrome\/|\bCriOS\//, 'Chrome'],
  [/\bSafari\//, 'Safari'],
]

const SYSTEMS: ReadonlyArray<[RegExp, string]> = [
  [/\bWindows\b/, 'Windows'],
  [/\b(?:iPhone|iPad|iPod)\b/, 'iOS'],
  [/\bAndroid\b/, 'Android'],
  [/\bMac OS X\b|\bMacintosh\b/, 'macOS'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bLinux\b/, 'Linux'],
]

export interface DeviceName {
  browser: string | null
  system: string | null
}

export function deviceOf(userAgent: string | null): DeviceName {
  if (!userAgent) return { browser: null, system: null }
  const browser = BROWSERS.find(([pattern]) => pattern.test(userAgent))?.[1] ?? null
  const system = SYSTEMS.find(([pattern]) => pattern.test(userAgent))?.[1] ?? null
  return { browser, system }
}
