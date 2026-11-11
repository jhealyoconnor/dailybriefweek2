import { TIME_ZONE } from '../config'
import { clockFormat, dublinDateKey } from '../google/dublinTime'
import type { FetchState } from '../hooks/useFetch'
import type { BlackboardData } from '../hooks/useBlackboard'
import { CardError } from './CardError'

const dayFormat = new Intl.DateTimeFormat('en-IE', { timeZone: TIME_ZONE, weekday: 'short', day: 'numeric', month: 'short' })

/** Whole Dublin calendar days from today to `date` (0 = today). */
function daysAway(date: Date, now = new Date()): number {
  const utc = (key: string) => {
    const [y, m, d] = key.split('-').map(Number)
    return Date.UTC(y, m - 1, d)
  }
  return Math.round((utc(dublinDateKey(date)) - utc(dublinDateKey(now))) / 86_400_000)
}

function dueLabel(days: number): string {
  if (days <= 0) return 'Due today'
  if (days === 1) return 'Due tomorrow'
  return `Due in ${days} days`
}

export function DeadlinesCard({ state }: { state: FetchState<BlackboardData> }) {
  const { data, loading, error, retry } = state

  return (
    <section className="card" aria-labelledby="deadlines-heading">
      <h2 id="deadlines-heading" className="card-label">
        Deadlines · next 7 days
      </h2>

      {loading && !data ? (
        <ul className="headlines" aria-busy="true">
          {Array.from({ length: 2 }, (_, i) => (
            <li key={i} className="headline-skeleton">
              <div className="skeleton skeleton-line" style={{ width: '30%' }} />
              <div className="skeleton skeleton-line" style={{ width: i ? '60%' : '80%' }} />
            </li>
          ))}
        </ul>
      ) : error && !data ? (
        <CardError message={`Couldn't load Blackboard deadlines. ${error}`} onRetry={retry} />
      ) : data && data.deadlines.length === 0 ? (
        <p className="card-empty">No deadlines this week 🎉</p>
      ) : data ? (
        <ul className="headlines">
          {data.deadlines.map((deadline) => {
            const due = new Date(deadline.due)
            const days = daysAway(due)
            return (
              <li key={deadline.id} className="deadline">
                <span className={`deadline-when${days <= 1 ? ' is-soon' : ''}`}>{dueLabel(days)}</span>
                <span className="deadline-title">{deadline.title}</span>
                <span className="deadline-date">
                  {dayFormat.format(due)} · {clockFormat.format(due)}
                </span>
              </li>
            )
          })}
        </ul>
      ) : null}
    </section>
  )
}
