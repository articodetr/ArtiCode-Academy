import { useLocation } from 'react-router'

/**
 * Mount at a redirect target to assert where navigation went and with which
 * state: `data-pathname` and `data-state` (JSON) on the element with test id `location`.
 */
export function LocationProbe() {
  const location = useLocation()
  return (
    <output
      data-testid="location"
      data-pathname={location.pathname}
      data-state={JSON.stringify(location.state ?? null)}
    >
      {location.pathname}
    </output>
  )
}
