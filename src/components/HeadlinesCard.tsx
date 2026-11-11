import { useFetch } from '../hooks/useFetch'
import { CardError } from './CardError'

// Generated at build/dev time by scripts/fetch-headlines.mjs (RTÉ's feed has no CORS).
const HEADLINES_URL = `${import.meta.env.BASE_URL}headlines.json`

type Story = { title: string; link: string; category: string; publishedAt: string }

function parseHeadlines(json: unknown): Story[] {
  const j = json as { items?: Story[]; error?: string }
  if (j.error) throw new Error(j.error)
  if (!Array.isArray(j.items) || j.items.length === 0) throw new Error('No stories available')
  return j.items.slice(0, 5)
}

const relative = new Intl.RelativeTimeFormat('en-IE', { numeric: 'auto' })

function timeAgo(iso: string): string {
  const minutes = Math.round((new Date(iso).getTime() - Date.now()) / 60_000)
  if (Number.isNaN(minutes)) return ''
  if (Math.abs(minutes) < 60) return relative.format(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) return relative.format(hours, 'hour')
  return relative.format(Math.round(hours / 24), 'day')
}

export function HeadlinesCard() {
  const { data, loading, error, retry } = useFetch<Story[]>(HEADLINES_URL, parseHeadlines)

  return (
    <section className="card" aria-labelledby="headlines-heading">
      <h2 id="headlines-heading" className="card-label">
        Top stories · RTÉ News
      </h2>

      {loading && !data ? (
        <ul className="headlines" aria-busy="true">
          {Array.from({ length: 5 }, (_, i) => (
            <li key={i} className="headline-skeleton">
              <div className="skeleton skeleton-line" style={{ width: '30%' }} />
              <div className="skeleton skeleton-line" style={{ width: i % 2 ? '80%' : '95%' }} />
            </li>
          ))}
        </ul>
      ) : error && !data ? (
        <CardError message="Couldn't load the headlines." onRetry={retry} />
      ) : data ? (
        <ol className="headlines">
          {data.map((story) => (
            <li key={story.link}>
              <a className="headline" href={story.link} target="_blank" rel="noopener noreferrer">
                <span className="headline-meta">
                  {story.category && <span className="headline-category">{story.category}</span>}
                  <span>{timeAgo(story.publishedAt)}</span>
                </span>
                <span className="headline-title">{story.title}</span>
                <span className="chevron" aria-hidden="true">›</span>
              </a>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  )
}
