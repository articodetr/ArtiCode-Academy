import { useMediaQuery } from '../common/useMediaQuery'

/** Below this width the side menu becomes a drawer opened from the header (antd's `lg` breakpoint). */
export const PHONE_QUERY = '(max-width: 991.98px)'

/** True while the window is narrower than a tablet in landscape — the phone layout of the app shell. */
export function useIsPhone(): boolean {
  return useMediaQuery(PHONE_QUERY)
}
