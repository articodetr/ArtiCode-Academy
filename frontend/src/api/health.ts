import { ApiError, apiGet } from './client'

/** Mirrors backend/src/health/health.dto.ts (API-002). */
export interface HealthReport {
  status: 'ok'
  service: string
  version: string
  environment: 'development' | 'test' | 'production'
  timestamp: string
  uptimeSeconds: number
}

export type DatabaseStatus = 'up' | 'down' | 'not_configured'

/** Mirrors ReadinessResponseDto (API-004). Served with 200 (ready) or 503 (not ready). */
export interface ReadinessReport {
  status: 'ready' | 'not_ready'
  checks: {
    database: {
      status: DatabaseStatus
      latencyMs?: number
      error?: string
    }
  }
  timestamp: string
}

export const HEALTH_PATH = '/api/health'
export const READINESS_PATH = '/api/health/ready'

export function fetchHealth(signal?: AbortSignal): Promise<HealthReport> {
  return apiGet<HealthReport>(HEALTH_PATH, { signal })
}

function isReadinessReport(value: unknown): value is ReadinessReport {
  return (
    typeof value === 'object' &&
    value !== null &&
    'checks' in value &&
    'status' in value
  )
}

/** A 503 still carries a full report, so it is returned rather than thrown. */
export async function fetchReadiness(signal?: AbortSignal): Promise<ReadinessReport> {
  try {
    return await apiGet<ReadinessReport>(READINESS_PATH, { signal })
  } catch (error) {
    if (error instanceof ApiError && error.status === 503 && isReadinessReport(error.body)) {
      return error.body
    }
    throw error
  }
}
