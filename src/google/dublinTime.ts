import { TIME_ZONE } from '../config'

const dateKeyFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})
const offsetFormat = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, timeZoneName: 'longOffset' })
export const clockFormat = new Intl.DateTimeFormat('en-IE', {
  timeZone: TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

/** 'YYYY-MM-DD' for the given instant, in Dublin. */
export function dublinDateKey(date: Date): string {
  return dateKeyFormat.format(date)
}

/** RFC 3339 timestamp for a Dublin wall-clock time on `dateKey` (handles GMT/IST). */
function dublinAt(dateKey: string, hh = '00'): string {
  const name = offsetFormat.formatToParts(new Date(`${dateKey}T${hh}:00:00Z`)).find((p) => p.type === 'timeZoneName')
  const offset = name && name.value !== 'GMT' ? name.value.slice(3) : '+00:00'
  return `${dateKey}T${hh}:00:00${offset}`
}
const dublinMidnight = (dateKey: string) => dublinAt(dateKey)

function shiftKey(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

/** 06:00 yesterday, Dublin time. */
export function dublinYesterdayMorning(now = new Date()): Date {
  return new Date(dublinAt(shiftKey(dublinDateKey(now), -1), '06'))
}

const weekdayFormat = new Intl.DateTimeFormat('en-IE', { timeZone: TIME_ZONE, weekday: 'short' })
const dayMonthFormat = new Intl.DateTimeFormat('en-IE', { timeZone: TIME_ZONE, day: 'numeric', month: 'short' })

/** Compact received time: '14:05' today, 'Mon' this week, else '9 Nov'. */
export function formatReceived(date: Date | null): string {
  if (!date) return ''
  const now = new Date()
  if (dublinDateKey(date) === dublinDateKey(now)) return clockFormat.format(date)
  const ageDays = (now.getTime() - date.getTime()) / 86_400_000
  return ageDays < 6 ? weekdayFormat.format(date) : dayMonthFormat.format(date)
}

export function isDublinToday(date: Date | null): boolean {
  return !!date && dublinDateKey(date) === dublinDateKey(new Date())
}

/** Start and end of today in Dublin, as RFC 3339 strings for the Calendar API. */
export function dublinToday(now = new Date()) {
  const key = dublinDateKey(now)
  return { key, start: dublinMidnight(key), end: dublinMidnight(shiftKey(key, 1)) }
}
