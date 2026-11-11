import { CardError } from './CardError'
import type { DigestState, FtState } from './FTSection'

export function FTBriefingCard({ ft, digest }: { ft: FtState; digest: DigestState }) {
  const bullets = digest.data?.digest?.briefing

  return (
    <section className="card" aria-labelledby="ft-briefing-heading">
      <h2 id="ft-briefing-heading" className="card-label">
        Today in the FT
      </h2>
      <p className="card-note ft-ai-label">AI summary of your FT newsletters</p>

      {ft.error && !ft.data ? (
        <CardError message="Couldn't load your FT emails." onRetry={ft.retry} />
      ) : digest.loading && !digest.data ? (
        <ul className="headlines" aria-busy="true">
          {Array.from({ length: 4 }, (_, i) => (
            <li key={i} className="headline-skeleton">
              <div className="skeleton skeleton-line" style={{ width: '25%' }} />
              <div className="skeleton skeleton-line" style={{ width: i % 2 ? '85%' : '95%' }} />
              <div className="skeleton skeleton-line" style={{ width: '70%' }} />
            </li>
          ))}
        </ul>
      ) : digest.error && !digest.data ? (
        <CardError
          message={/daily ai limit/i.test(digest.error) ? digest.error : `Couldn't summarise your FT newsletters. ${digest.error}`}
          onRetry={digest.retry}
        />
      ) : digest.data && !bullets ? (
        <p className="card-empty">No new FT newsletters since yesterday morning.</p>
      ) : bullets ? (
        <ul className="headlines">
          {bullets.map((b, i) => (
            <li key={i} className="ft-bullet">
              <span className="ft-tag">{b.newsletter}</span>
              <span className="ft-what">{b.what}</span>
              <span className="ft-why">{b.why}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
