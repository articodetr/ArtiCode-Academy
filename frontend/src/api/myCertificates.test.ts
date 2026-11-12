import { beforeEach, describe, expect, it } from 'vitest'
import { setAccessToken } from '../auth/token-store'
import { CLASS_ID } from '../test/classes'
import { jsonResponse, mockFetch } from '../test/http'
import { makeMyCertificate, makeMyCertificateList } from '../test/myCertificates'
import { listMyCertificates, myCertificatesPath } from './myCertificates'

describe('«my certificates» API (API-135)', () => {
  beforeEach(() => {
    setAccessToken('access-1')
  })

  it('builds the path with the given filters only, in a fixed order', () => {
    expect(myCertificatesPath()).toBe('/api/me/certificates')
    expect(myCertificatesPath({ classId: '', studentId: undefined })).toBe('/api/me/certificates')
    expect(myCertificatesPath({ studentId: 's-1', classId: CLASS_ID })).toBe(`/api/me/certificates?classId=${CLASS_ID}&studentId=s-1`)
  })

  it('reads with the Bearer token and the abort signal, and returns the items as the server sends them', async () => {
    const list = makeMyCertificateList([makeMyCertificate()])
    const fetchMock = mockFetch(() => jsonResponse(200, list))
    const controller = new AbortController()
    await expect(listMyCertificates({}, controller.signal)).resolves.toEqual(list)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/me/certificates')
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer access-1')
    expect(init?.signal).toBe(controller.signal)
    // The owner's view carries no issuer, revoker or reason (MyCertificateItemDto).
    for (const field of ['issuedBy', 'revokedBy', 'revokeReason']) expect(list.items[0]).not.toHaveProperty(field)
  })
})
