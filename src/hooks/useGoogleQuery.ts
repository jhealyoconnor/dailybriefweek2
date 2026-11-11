import { useCallback, useEffect, useRef, useState } from 'react'
import type { FetchState } from './useFetch'

export type GoogleLoader<T> = (token: string, signal: AbortSignal) => Promise<T>

/**
 * Like useFetch, but runs an authenticated loader with the current Google token.
 * Re-runs when `token` or `key` changes (pass e.g. a message ID as `key`).
 */
export function useGoogleQuery<T>(token: string, loader: GoogleLoader<T>, key = ''): FetchState<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const lastKey = useRef(key)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    // A new key is a different query: drop the old result (a retry keeps it on screen).
    if (lastKey.current !== key) {
      lastKey.current = key
      setData(null)
    }

    loader(token, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setData(result) // ignore answers to superseded requests
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setError(err instanceof Error ? err.message : 'Something went wrong')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
    // `loader` may be an inline closure; whatever it depends on must be reflected in `key`.
  }, [token, key, attempt])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])
  return { data, loading, error, retry }
}
