// The certificate a print page prints (J-F51): read through API-131 for the
// holders of `certificates.read_all` or `certificates.issue` (`academy`), or
// found in API-135 — the caller's own and their linked children's
// certificates, with the snapshot to print and never the reason — for a
// student or a guardian (`own`; API-135 has no detail route). One request per
// page and reload, aborted when the page leaves.
import { useCallback, useEffect, useState } from 'react'
import { getCertificate } from '../api/certificates'
import type { Certificate } from '../api/certificates'
import { listMyCertificates } from '../api/myCertificates'

/** Where the print page reads its certificate. */
export type PrintSource = 'academy' | 'own'

/** What a print needs — the same fields in API-131 and API-135. */
export type PrintableCertificate = Pick<Certificate, 'id' | 'serial' | 'verificationCode' | 'status' | 'snapshot' | 'revokedAt'>

interface ReadingState {
  key: string
  certificate: PrintableCertificate | null
  /** True when the server has no such certificate for the caller (API-131's 404, or none in API-135 with this id). */
  notFound: boolean
  error: unknown
}

async function readPrintable(source: PrintSource, id: string, signal: AbortSignal): Promise<PrintableCertificate | null> {
  if (source === 'academy') return getCertificate(id, signal)
  const list = await listMyCertificates({}, signal)
  return list.items.find((item) => item.id === id) ?? null
}

export function usePrintedCertificate(source: PrintSource, id: string | undefined) {
  const [reloadTick, setReloadTick] = useState(0)
  const [state, setState] = useState<ReadingState>({ key: '', certificate: null, notFound: false, error: null })
  const requestKey = `${source}:${id ?? ''}:${reloadTick}`
  const loading = state.key !== requestKey

  useEffect(() => {
    if (!id) return
    const controller = new AbortController()
    readPrintable(source, id, controller.signal)
      .then((certificate) => {
        if (!controller.signal.aborted) setState({ key: requestKey, certificate, notFound: certificate === null, error: null })
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState({ key: requestKey, certificate: null, notFound: false, error })
      })
    return () => controller.abort()
  }, [source, id, requestKey])

  const reload = useCallback(() => setReloadTick((tick) => tick + 1), [])

  return { certificate: state.certificate, notFound: state.notFound, error: state.error, loading: id ? loading : false, reload }
}
