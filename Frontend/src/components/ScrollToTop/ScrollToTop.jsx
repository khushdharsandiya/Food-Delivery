import { useLayoutEffect } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * Har route change par window top par — nahi to SPA purana scroll position dikhata hai.
 */
export default function ScrollToTop() {
  const { pathname } = useLocation()

  useLayoutEffect(() => {
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual'
    }
    window.scrollTo(0, 0)
  }, [pathname])

  return null
}
