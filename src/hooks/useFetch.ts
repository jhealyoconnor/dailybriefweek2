import { useCallback, useEffect, useState } from 'react'

export type FetchState<T> = {
  data: T | null
  loading: boolean
  error: string | null
  retry: () => void
}

/** Fetches JSON from `url`, cancelling the request if the component unmounts. */
export function useFetch<T>(url: string, validate?: (json: unknown) => T): FetchState<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)

    fetch(url, { signal: controller.signal, cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Request failed (${res.status})`)
        const json: unknown = await res.json()
        setData(validate ? validate(json) : (json as T))
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setError(err instanceof Error ? err.message : 'Something went wrong')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
    // `validate` is expected to be a stable, module-level function.
  }, [url, attempt])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])
  return { data, loading, error, retry }
}
