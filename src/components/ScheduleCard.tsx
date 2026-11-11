import { clockFormat } from '../google/dublinTime'
import type { FetchState } from '../hooks/useFetch'
import type { BlackboardData } from '../hooks/useBlackboard'
import { CardError } from './CardError'

export function ScheduleCard({ state }: { state: FetchState<BlackboardData> }) {
  const { data, loading, error, retry } = state

  return (
    <section className="card" aria-labelledby="schedule-heading">
      <h2 id="schedule-heading" className="card-label">
        Lectures today · Blackboard
      </h2>

      {loading && !data ? (
        <ul className="headlines" aria-busy="true">
          {Array.from({ length: 2 }, (_, i) => (
            <li key={i} className="headline-skeleton">
              <div className="skeleton skeleton-line" style={{ width: i ? '55%' : '75%' }} />
            </li>
          ))}
        </ul>
      ) : error && !data ? (
        <CardError message={`Couldn't load Blackboard. ${error}`} onRetry={retry} />
      ) : data ? (
        <>
          {data.today.length === 0 ? (
            <p className="card-empty">No lectures today</p>
          ) : (
            <ul className="headlines">
              {data.today.map((item) => (
                <li key={item.id} className="event">
                  <span className="event-time">
                    {item.allDay
                      ? 'All day'
                      : `${clockFormat.format(new Date(item.start))}–${clockFormat.format(new Date(item.end))}`}
                  </span>
                  <span className="event-title">
                    {item.title}
                    {item.location && <span className="event-location">{item.location}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {!data.hasLectureEvents && (
            <p className="card-note">Your Blackboard feed only has deadlines, no lecture times.</p>
          )}
        </>
      ) : null}
    </section>
  )
}
