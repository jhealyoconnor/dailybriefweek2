import { useSyncExternalStore } from 'react'

/*
 * Emails you've opened in the reader. Only Gmail message IDs are stored (in this
 * browser's localStorage), so "Previously viewed" survives a reload. Gmail itself
 * isn't touched: the emails stay unread there.
 */

const KEY = 'viewedEmailIds'
const MAX = 300

function read(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

let ids = new Set(read())
const listeners = new Set<() => void>()

export function markViewed(id: string) {
  if (ids.has(id)) return
  ids = new Set([...ids, id])
  try {
    localStorage.setItem(KEY, JSON.stringify([...ids].slice(-MAX)))
  } catch {
    // Storage unavailable (private mode etc.): still works for this session.
  }
  listeners.forEach((l) => l())
}

export function useViewedEmails(): Set<string> {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => ids,
  )
}
