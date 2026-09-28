import { useEffect, useState } from 'react'

// Hash routes: no router dependency for four screens, and the server needs no
// SPA fallback because every URL is `/`.
export type Route = 'today' | 'applications' | 'board' | 'stats'
export const ROUTES: { id: Route; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'applications', label: 'Applications' },
  { id: 'board', label: 'Board' },
  { id: 'stats', label: 'Stats' },
]

export function parseRoute(hash: string): Route {
  const id = hash.replace(/^#\/?/, '')
  return ROUTES.some(r => r.id === id) ? (id as Route) : 'today'
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(location.hash))
  useEffect(() => {
    const on = () => setRoute(parseRoute(location.hash))
    addEventListener('hashchange', on)
    return () => removeEventListener('hashchange', on)
  }, [])
  return route
}
