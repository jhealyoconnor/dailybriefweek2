import { expire } from '../auth/googleAuth'

/**
 * GET a Google API URL with the in-memory access token. A 401 drops the token,
 * which signs the user out and unmounts the cards that use it.
 */
export async function googleFetch<T>(url: string, token: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    signal,
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  })
  if (res.status === 401) {
    expire()
    throw new Error('Signed out')
  }
  if (res.status === 403) throw new Error('Google refused access (403).')
  if (!res.ok) throw new Error(`Google request failed (${res.status}).`)
  return (await res.json()) as T
}
