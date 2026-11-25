import { beforeEach, describe, expect, it } from 'vitest'
import { setAccessToken } from '../auth/token-store'
import { customImage, makeHomepageImages, pictureFile, pngBytes } from '../homepageImages/homepageImages.testData'
import { jsonResponse, mockFetch } from '../test/http'
import { getHomepageImages, HOMEPAGE_IMAGE_CONTENT_TYPES, HOMEPAGE_IMAGE_MAX_BYTES, resetHomepageImage, uploadHomepageImage } from './homepageImages'

describe('homepage images API (GET, PUT and DELETE /api/academy/homepage-images)', () => {
  beforeEach(() => {
    setAccessToken('access-1')
  })

  it('reads the four places with the Bearer token and the abort signal', async () => {
    const answer = makeHomepageImages({ heroStudent: customImage('heroStudent') })
    const fetchMock = mockFetch(() => jsonResponse(200, answer))
    const controller = new AbortController()

    await expect(getHomepageImages(controller.signal)).resolves.toEqual(answer)

    const [[url, init]] = fetchMock.mock.calls
    expect(url).toBe('/api/academy/homepage-images')
    expect(init?.method).toBe('GET')
    expect(init?.signal).toBe(controller.signal)
    expect(init?.credentials).toBe('include')
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer access-1')
  })

  it('uploads the picture itself as the body of ONE PUT, with the type read from its bytes — never JSON, never multipart', async () => {
    const answer = makeHomepageImages({ promoTraining: customImage('promoTraining') })
    const fetchMock = mockFetch(() => jsonResponse(200, answer))
    // The browser guessed nothing from the name; the type sent is the detected one.
    const file = pictureFile(pngBytes(), 'promo', '')

    await expect(uploadHomepageImage('promoTraining', file, 'image/png')).resolves.toEqual(answer)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [[url, init]] = fetchMock.mock.calls
    expect(url).toBe('/api/academy/homepage-images/promoTraining')
    expect(init?.method).toBe('PUT')
    expect(init?.body).toBe(file)
    expect(new Headers(init?.headers).get('Content-Type')).toBe('image/png')
  })

  it('restores the default of one place with a DELETE and returns the list the server answers', async () => {
    const answer = makeHomepageImages()
    const fetchMock = mockFetch(() => jsonResponse(200, answer))

    await expect(resetHomepageImage('whyClassroom')).resolves.toEqual(answer)

    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method, init?.body])).toEqual([['/api/academy/homepage-images/whyClassroom', 'DELETE', undefined]])
  })

  it('surfaces the stable code and details of a refusal', async () => {
    mockFetch(() => jsonResponse(400, { statusCode: 400, code: 'image_dimensions_invalid', message: 'bad', width: 10, height: 10, minSide: 64, maxSide: 8000, maxPixels: 40_000_000 }))
    await expect(uploadHomepageImage('heroStudent', new Blob([pngBytes()]), 'image/png')).rejects.toMatchObject({
      status: 400,
      code: 'image_dimensions_invalid',
      body: { width: 10, minSide: 64 },
    })
  })

  it('names the limits of the contract', () => {
    expect(HOMEPAGE_IMAGE_MAX_BYTES).toBe(5 * 1024 * 1024)
    expect([...HOMEPAGE_IMAGE_CONTENT_TYPES]).toEqual(['image/png', 'image/jpeg', 'image/webp'])
  })
})
