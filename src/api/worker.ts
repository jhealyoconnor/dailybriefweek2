import { WORKER_URL } from '../config'

/**
 * A failed Worker call. `code` is the Worker's short reason when it gave one:
 * ai_busy, ai_quota, ai_error, signin_expired, not_allowed — or 'network' if it couldn't be reached.
 */
export class WorkerError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message)
  }
}

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
    throw new WorkerError('Couldn’t reach the Worker.', 0, 'network')
  }
  if (!res.ok) {
    const info = (await res.json().catch(() => null)) as { error?: unknown; code?: unknown } | null
    const code = typeof info?.code === 'string' ? info.code : undefined
    if (res.status === 401) throw new WorkerError('The Worker didn’t accept your sign-in.', 401, code)
    const message = typeof info?.error === 'string' ? info.error : `Worker request failed (${res.status}).`
    throw new WorkerError(message, res.status, code)
  }
  return (await res.json()) as T
}
