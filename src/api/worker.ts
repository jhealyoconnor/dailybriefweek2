import { WORKER_URL } from '../config'

/**
 * Call the Cloudflare Worker with the in-memory Google token.
 * A 401 here does NOT sign you out: Google still accepts the token, the Worker
 * just didn't (e.g. ALLOWED_EMAIL doesn't match), so signing out wouldn't help.
 */
export async function workerFetch<T>(
  path: string,
  token: string,
  signal: AbortSignal,
  body?: unknown,
): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${WORKER_URL}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      signal,
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (err) {
    if (signal.aborted) throw err
    throw new Error('Couldn’t reach the Worker.')
  }
  if (res.status === 401) throw new Error('The Worker didn’t accept your sign-in.')
  if (!res.ok) {
    const message = ((await res.json().catch(() => null)) as { error?: unknown } | null)?.error
    throw new Error(typeof message === 'string' ? message : `Worker request failed (${res.status}).`)
  }
  return (await res.json()) as T
}
