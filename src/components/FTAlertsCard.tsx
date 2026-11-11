import { clockFormat } from '../google/dublinTime'
import type { EmailSummary } from '../google/gmail'
import { CardError } from './CardError'
import type { FtState } from './FTSection'

export function FTAlertsCard({ ft, onOpen }: { ft: FtState; onOpen: (email: EmailSummary) => void }) {
  const { data, loading, error, retry } = ft
  const alerts = data?.alertsToday

  return (
    <section className="card" aria-labelledby="ft-alerts-heading">
      <h2 id="ft-alerts-heading" className="card-label">
        FT alerts · today{alerts?.length ? ` · ${alerts.length}` : ''}
      </h2>

      {loading && !data ? (
        <ul className="headlines" aria-busy="true">
          {Array.from({ length: 3 }, (_, i) => (
            <li key={i} className="headline-skeleton">
              <div className="skeleton skeleton-line" style={{ width: i % 2 ? '70%' : '85%' }} />
            </li>
          ))}
        </ul>
      ) : error && !data ? (
        <CardError message="Couldn't load your FT alerts." onRetry={retry} />
      ) : alerts && alerts.length === 0 ? (
        <p className="card-empty">No FT alerts today</p>
      ) : alerts ? (
        <ul className="headlines">
          {alerts.map((alert) => (
            <li key={alert.id}>
              <button type="button" className="email alert-row" onClick={() => onOpen(alert)} aria-haspopup="dialog">
                <span className="email-time">{alert.received ? clockFormat.format(alert.received) : ''}</span>
                <span className="alert-subject">{alert.subject}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
