import { TIME_ZONE } from '../config'
import { clockFormat, dublinToday } from '../google/dublinTime'
import { googleFetch } from '../google/googleFetch'
import { useGoogleQuery } from '../hooks/useGoogleQuery'
import { CardError } from './CardError'

type EventTime = { date?: string; dateTime?: string }
type ApiEvent = { id: string; summary?: string; status?: string; start: EventTime; end: EventTime }

type CalendarEvent = { id: string; title: string; when: string; allDay: boolean }

async function loadToday(token: string, signal: AbortSignal): Promise<CalendarEvent[]> {
  const { start, end } = dublinToday()
  const params = new URLSearchParams({
    timeMin: start,
    timeMax: end,
    singleEvents: 'true',
    orderBy: 'startTime',
    timeZone: TIME_ZONE,
    maxResults: '50',
  })
  const res = await googleFetch<{ items?: ApiEvent[] }>(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
    token,
    signal,
  )

  const dayStart = new Date(start).getTime()
  const dayEnd = new Date(end).getTime()
  const events = (res.items ?? []).filter((e) => e.status !== 'cancelled')

  const toEvent = (e: ApiEvent): CalendarEvent => {
    const title = e.summary?.trim() || '(No title)'
    if (e.start.date || !e.start.dateTime || !e.end.dateTime) return { id: e.id, title, when: 'All day', allDay: true }
    const s = new Date(e.start.dateTime)
    const f = new Date(e.end.dateTime)
    const startsEarlier = s.getTime() < dayStart
    const endsLater = f.getTime() > dayEnd
    let when = `${clockFormat.format(s)}–${clockFormat.format(f)}`
    if (startsEarlier && endsLater) when = 'All day'
    else if (startsEarlier) when = `Until ${clockFormat.format(f)}`
    else if (endsLater) when = `From ${clockFormat.format(s)}`
    return { id: e.id, title, when, allDay: startsEarlier && endsLater }
  }

  const all = events.map(toEvent)
  // Already sorted by start time; stable sort just lifts all-day events to the top.
  return [...all.filter((e) => e.allDay), ...all.filter((e) => !e.allDay)]
}

export function CalendarCard({ token }: { token: string }) {
  const { data, loading, error, retry } = useGoogleQuery(token, loadToday)

  return (
    <section className="card" aria-labelledby="calendar-heading">
      <h2 id="calendar-heading" className="card-label">
        Today
      </h2>

      {loading && !data ? (
        <ul className="headlines" aria-busy="true">
          {Array.from({ length: 3 }, (_, i) => (
            <li key={i} className="headline-skeleton">
              <div className="skeleton skeleton-line" style={{ width: i % 2 ? '55%' : '75%' }} />
            </li>
          ))}
        </ul>
      ) : error && !data ? (
        <CardError message="Couldn't load your calendar." onRetry={retry} />
      ) : data && data.length === 0 ? (
        <p className="card-empty">Nothing on today</p>
      ) : data ? (
        <ul className="headlines">
          {data.map((event) => (
            <li key={event.id} className="event">
              <span className="event-time">{event.when}</span>
              <span className="event-title">{event.title}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
