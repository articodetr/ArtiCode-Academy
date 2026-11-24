// The browser side of choosing a picture: reading its bytes, turning them into the
// `data:` URL of its preview, and — for the hero, whose picture is a cut-out person on a
// transparent background — looking at its four corner pixels on a canvas. Nothing here
// sends anything; the rules live in homepageImages.rules.ts.
//
// The preview is a `data:` URL, never an object URL (`blob:`): the deployed app's
// Content-Security-Policy (deploy/Caddyfile, `img-src 'self' data: https:`) refuses
// `blob:` pictures, so an object URL would show nothing there.
import { cornersOpaque } from './homepageImages.rules'

/** The bytes of a chosen file (`Blob.arrayBuffer`, else a FileReader in an older browser). */
export function readPictureBytes(file: Blob): Promise<Uint8Array<ArrayBuffer>> {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer().then((buffer) => new Uint8Array(buffer))
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsArrayBuffer(file)
  })
}

/**
 * The `data:` URL of a picture's bytes under the type read from them (not the type the
 * browser guessed from the file name), for the preview and the corner check.
 */
export function readPictureDataUrl(bytes: Uint8Array<ArrayBuffer>, contentType: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => (typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('read failed')))
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsDataURL(new Blob([bytes], { type: contentType }))
  })
}

/** How long the corner check waits for the browser to decode the picture before it gives up silently. */
const DECODE_TIMEOUT_MS = 10_000

/**
 * True when the four corner pixels of the picture at `src` (the `data:` URL of the chosen
 * file — a `data:` picture never taints the canvas) are all fully opaque, false when one
 * of them is not, and null when it cannot tell: no canvas (jsdom), a picture the browser
 * cannot decode, a timeout, or `signal` aborted. Each corner pixel is copied on its own
 * into a 2 × 2 canvas, so a picture of any size costs four pixels.
 */
export function checkOpaqueCorners(src: string, signal: AbortSignal): Promise<boolean | null> {
  return new Promise((resolve) => {
    if (signal.aborted || typeof Image !== 'function' || typeof document === 'undefined') {
      resolve(null)
      return
    }
    const image = new Image()
    let settled = false
    const finish = (result: boolean | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      image.onload = null
      image.onerror = null
      resolve(result)
    }
    const abort = () => finish(null)
    const timer = setTimeout(abort, DECODE_TIMEOUT_MS)
    signal.addEventListener('abort', abort)
    image.onerror = abort
    image.onload = () => {
      try {
        const { naturalWidth: width, naturalHeight: height } = image
        const canvas = document.createElement('canvas')
        canvas.width = 2
        canvas.height = 2
        const context = canvas.getContext('2d')
        if (!context || width < 1 || height < 1) {
          finish(null)
          return
        }
        context.imageSmoothingEnabled = false
        context.clearRect(0, 0, 2, 2)
        context.drawImage(image, 0, 0, 1, 1, 0, 0, 1, 1)
        context.drawImage(image, width - 1, 0, 1, 1, 1, 0, 1, 1)
        context.drawImage(image, 0, height - 1, 1, 1, 0, 1, 1, 1)
        context.drawImage(image, width - 1, height - 1, 1, 1, 1, 1, 1, 1)
        finish(cornersOpaque(context.getImageData(0, 0, 2, 2).data))
      } catch {
        finish(null)
      }
    }
    image.src = src
  })
}
