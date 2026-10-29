// Minimal HTTP client for the backend. Paths include the backend prefix (/api/...).

const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '')

export class ApiError extends Error {
  readonly status: number
  readonly body: unknown

  constructor(status: number, message: string, body?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

export function apiUrl(path: string): string {
  return `${BASE_URL}${path.startsWith('/') ? path : `/${path}`}`
}

function messageFrom(body: unknown, fallback: string): string {
  if (typeof body === 'object' && body !== null && 'message' in body) {
    const { message } = body as { message: unknown }
    if (typeof message === 'string') return message
    if (Array.isArray(message)) return message.join(', ')
  }
  return fallback
}

export async function apiGet<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  if (!headers.has('Accept')) headers.set('Accept', 'application/json')

  const response = await fetch(apiUrl(path), { ...init, headers })
  const body: unknown = await response.json().catch(() => undefined)

  if (!response.ok) {
    throw new ApiError(
      response.status,
      messageFrom(body, `${response.status} ${response.statusText}`),
      body,
    )
  }
  return body as T
}
