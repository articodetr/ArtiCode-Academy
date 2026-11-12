// Who may do what on the certificates screens (J-F51): the keys the server
// enforces — mirrors of backend/src/certificates/certificates.policy.ts and of
// the three controllers (keep them in sync). UI-level only: the server stays
// the boundary and answers `403 permission_denied` to anything else.

export const READ_ALL_CERTIFICATES_PERMISSION = 'certificates.read_all'
export const ISSUE_CERTIFICATES_PERMISSION = 'certificates.issue'
export const REVOKE_CERTIFICATES_PERMISSION = 'certificates.revoke'
export const READ_OWN_CERTIFICATES_PERMISSION = 'certificates.read_own'
export const READ_LINKED_CERTIFICATES_PERMISSION = 'certificates.read_linked'

/**
 * D-R57: the list (API-130), the details (API-131) and a class's preview
 * (API-136) open with either key — staff issue without `read_all`.
 */
export const CERTIFICATE_READ_PERMISSIONS = [READ_ALL_CERTIFICATES_PERMISSION, ISSUE_CERTIFICATES_PERMISSION] as const

type HasPermission = (key: string) => boolean

/** `certificatesReadMissing()` is null: the caller holds `read_all` or `issue`. */
export function canReadCertificates(hasPermission: HasPermission): boolean {
  return CERTIFICATE_READ_PERMISSIONS.some((key) => hasPermission(key))
}

/** API-132 — academy-wide, without the class visibility of D-R16 (D-R52). */
export function canIssueCertificates(hasPermission: HasPermission): boolean {
  return hasPermission(ISSUE_CERTIFICATES_PERMISSION)
}

/** API-133 — the academy admin by seed. */
export function canRevokeCertificates(hasPermission: HasPermission): boolean {
  return hasPermission(REVOKE_CERTIFICATES_PERMISSION)
}
