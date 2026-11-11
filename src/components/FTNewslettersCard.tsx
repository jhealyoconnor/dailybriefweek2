import { formatReceived, isDublinToday } from '../google/dublinTime'
import type { EmailSummary } from '../google/gmail'
import { CardError } from './CardError'
import type { DigestState, FtState } from './FTSection'

type Props = { ft: FtState; digest: DigestState; onOpen: (email: EmailSummary) => void }

export function FTNewslettersCard({ ft, digest, onOpen }: Props) {
  const { data, loading, error, retry } = ft
  const summaries = digest.data?.digest?.summaries

  return (
    <section className="card" aria-labelledby="ft-newsletters-heading">
      <h2 id="ft-newsletters-heading" className="card-label">
        FT newsletters · last 7 days
      </h2>

      {loading && !data ? (
        <ul className="headlines" aria-busy="true">
          {Array.from({ length: 4 }, (_, i) => (
            <li key={i} className="headline-skeleton">
              <div className="skeleton skeleton-line" style={{ width: '45%' }} />
              <div className="skeleton skeleton-line" style={{ width: '90%' }} />
            </li>
          ))}
        </ul>
      ) : error && !data ? (
        <CardError message="Couldn't load your FT newsletters." onRetry={retry} />
      ) : data ? (
        <ul className="headlines">
          {data.newsletters.map(({ name, issues }) => {
            const latest = issues[0]
            if (!latest) {
              return (
                <li key={name} className="ft-row is-empty">
                  <span className="email-from">{name}</span>
                  <span className="ft-summary">No issues in the last 7 days</span>
                </li>
              )
            }
            const summary = summaries?.get(latest.id)
            const summarising = !summary && digest.loading
            return (
              <li key={name}>
                <button type="button" className="email ft-row" onClick={() => onOpen(latest)} aria-haspopup="dialog">
                  <span className="email-from">
                    {isDublinToday(latest.received) && <span className="new-dot" aria-label="New today" />}
                    {name}
                  </span>
                  <span className="email-time">{formatReceived(latest.received)}</span>
                  {summary ? (
                    <span className="ft-summary">{summary}</span>
                  ) : summarising ? (
                    <span className="ft-summary">
                      <span className="skeleton skeleton-line" style={{ display: 'block', width: '85%' }} />
                    </span>
                  ) : (
                    <span className="ft-summary is-subject">{latest.subject}</span>
                  )}
                </button>
              </li>
            )
          })}

          {data.other.length > 0 && (
            <>
              <li className="inbox-group">
                <h3>Other FT · {data.other.length}</h3>
              </li>
              {data.other.map((email) => (
                <li key={email.id}>
                  <button type="button" className="email ft-row" onClick={() => onOpen(email)} aria-haspopup="dialog">
                    <span className="email-from">{email.from}</span>
                    <span className="email-time">{formatReceived(email.received)}</span>
                    <span className="ft-summary is-subject">{email.subject}</span>
                  </button>
                </li>
              ))}
            </>
          )}
        </ul>
      ) : null}
    </section>
  )
}
