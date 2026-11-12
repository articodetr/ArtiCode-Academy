// The issuing plan of the certificates tab of a class (J-F51 on API-136 and
// API-132): which enrollments may be chosen, the body of the issuing request
// and what its answer says. Every reason is the server's — nothing here decides
// eligibility (D-R52): an enrollment can be chosen when the class is completed
// and the preview gave it no reason. Pure; unit-tested in certificates.issue.test.ts.
import { INELIGIBLE_REASONS } from '../api/certificates'
import type { ClassCertificates, IneligibleReason, IssueCertificatesInput, IssueCertificatesResult } from '../api/certificates'

/** The enrollments an issuing request would give a certificate now, in enrollment order. */
export function eligibleEnrollmentIds(preview: ClassCertificates): string[] {
  if (preview.class.status !== 'completed') return []
  return preview.items.filter((item) => item.reason === null).map((item) => item.enrollmentId)
}

/** The chosen enrollments that are still eligible (a re-read may have changed them), in enrollment order. */
export function chosenEnrollmentIds(selected: readonly string[], eligible: readonly string[]): string[] {
  const picked = new Set(selected)
  return eligible.filter((id) => picked.has(id))
}

/** API-132's body: the chosen enrollments, or `{}` — every eligible enrollment of the class. */
export function issueBodyOf(chosen: readonly string[]): IssueCertificatesInput {
  return chosen.length > 0 ? { enrollmentIds: [...chosen] } : {}
}

export interface IssueOutcome {
  issued: number
  skipped: number
  /** The skipped enrollments by reason, in the server's order of the reasons. */
  byReason: Array<{ reason: IneligibleReason; count: number }>
}

/** The answer of API-132 as counts. */
export function issueOutcomeOf(result: IssueCertificatesResult): IssueOutcome {
  const counts = new Map<IneligibleReason, number>()
  for (const skipped of result.skipped) counts.set(skipped.reason, (counts.get(skipped.reason) ?? 0) + 1)
  return {
    issued: result.issued.length,
    skipped: result.skipped.length,
    byReason: INELIGIBLE_REASONS.filter((reason) => counts.has(reason)).map((reason) => ({ reason, count: counts.get(reason)! })),
  }
}
