import { describe, expect, it } from 'vitest'
import { deviceOf } from './sessions.format'

describe('deviceOf (CH-0265)', () => {
  it('names the browser and the system of common User-Agent headers', () => {
    expect(deviceOf('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0 Safari/537.36')).toEqual({ browser: 'Chrome', system: 'Windows' })
    expect(deviceOf('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0 Safari/537.36 Edg/142.0')).toEqual({ browser: 'Edge', system: 'Windows' })
    expect(deviceOf('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')).toEqual({ browser: 'Safari', system: 'iOS' })
    expect(deviceOf('Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0')).toEqual({ browser: 'Firefox', system: 'Linux' })
    expect(deviceOf('Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0 Mobile Safari/537.36')).toEqual({ browser: 'Chrome', system: 'Android' })
  })

  it('says nothing it cannot read', () => {
    expect(deviceOf(null)).toEqual({ browser: null, system: null })
    expect(deviceOf('curl/8.5.0')).toEqual({ browser: null, system: null })
  })
})
