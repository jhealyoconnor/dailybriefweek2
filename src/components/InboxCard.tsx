import { useState, type ReactNode } from 'react'
import { workerFetch } from '../api/worker'
import { formatReceived } from '../google/dublinTime'
import { isFtAddress, loadAccountEmail, searchEmails, type EmailSummary } from '../google/gmail'
import { useGoogleQuery } from '../hooks/useGoogleQuery'
import { markViewed, useViewedEmails } from '../viewedEmails'
import { CardError } from './CardError'
import { EmailSheet } from './EmailSheet'

type Email = EmailSummary
type Inbox = { account: string; emails: Email[] }

// FT mail has its own cards, so it's kept out of the inbox and out of triage.
const INBOX_QUERY = 'is:unread in:inbox -from:ft.com'

async function loadInbox(token: string, signal: AbortSignal): Promise<Inbox> {
  const [emails, account] = await Promise.all([
    searchEmails(INBOX_QUERY, 10, token, signal),
    loadAccountEmail(token, signal),
  ])
  return { account, emails: emails.filter((e) => !isFtAddress(e.fromAddress)) }
}

export function InboxCard({ token }: { token: string }) {
  const { data, loading, error, retry } = useGoogleQuery(token, loadInbox)
  const viewed = useViewedEmails()
  const [open, setOpen] = useState<Email | null>(null)
  const newCount = data?.emails.filter((e) => !viewed.has(e.id)).length

  const close = () => {
    if (open) markViewed(open.id) // after reading, it moves to "Previously viewed"
    setOpen(null)
  }

  return (
    <section className="card" aria-labelledby="inbox-heading">
      <h2 id="inbox-heading" className="card-label">
        Unread mail{newCount ? ` · ${newCount} new` : ''}
      </h2>

      {loading && !data ? (
        <ul className="headlines" aria-busy="true">
          {Array.from({ length: 4 }, (_, i) => (
            <li key={i} className="headline-skeleton">
              <div className="skeleton skeleton-line" style={{ width: '40%' }} />
              <div className="skeleton skeleton-line" style={{ width: '85%' }} />
              <div className="skeleton skeleton-line" style={{ width: '65%' }} />
            </li>
          ))}
        </ul>
      ) : error && !data ? (
        <CardError message="Couldn't load your email." onRetry={retry} />
      ) : data && data.emails.length === 0 ? (
        <p className="card-empty">No unread email. 🎉</p>
      ) : data ? (
        <SortedInbox token={token} emails={data.emails} viewed={viewed} onOpen={setOpen} />
      ) : null}

      {open && data && <EmailSheet token={token} account={data.account} email={open} onClose={close} />}
    </section>
  )
}

// ---- Gemini triage (via the Worker) ----

type Category = 'urgent' | 'needs_reply' | 'fyi' | 'ignore'
type Triage = { id: string; category: Category; reason: string }

const GROUPS: { category: Category; label: string }[] = [
  { category: 'urgent', label: 'Urgent' },
  { category: 'needs_reply', label: 'Needs reply' },
  { category: 'fyi', label: 'FYI' },
  { category: 'ignore', label: 'Ignore' },
]

/** Only id/sender/subject/snippet leave the browser — never message bodies. */
async function triageEmails(emails: Email[], token: string, signal: AbortSignal): Promise<Map<string, Triage>> {
  const body = { emails: emails.map((e) => ({ id: e.id, sender: e.from, subject: e.subject, snippet: e.snippet })) }
  const { results } = await workerFetch<{ results: Triage[] }>('/triage', token, signal, body)
  const byId = new Map(results.map((r) => [r.id, r]))
  if (!emails.every((e) => byId.has(e.id))) throw new Error('Incomplete triage')
  return byId
}

type SortedProps = { token: string; emails: Email[]; viewed: Set<string>; onOpen: (e: Email) => void }

function SortedInbox({ token, emails, viewed, onOpen }: SortedProps) {
  // Triage covers every email (keyed on all ids), so opening one doesn't trigger a new Gemini call.
  const { data: sorted, loading, error } = useGoogleQuery(
    token,
    (t, signal) => triageEmails(emails, t, signal),
    emails.map((e) => e.id).join(','),
  )
  const fresh = emails.filter((e) => !viewed.has(e.id))
  const seen = emails.filter((e) => viewed.has(e.id))
  const row = (email: Email) => (
    <li key={email.id}>
      <EmailRow email={email} reason={sorted?.get(email.id)?.reason} onOpen={onOpen} />
    </li>
  )

  return (
    <>
      {!sorted && (
        <p className="card-note inbox-status" aria-live="polite">
          {loading ? 'Sorting…' : error ? 'Couldn’t sort, showing newest first.' : ''}
        </p>
      )}
      <ul className="headlines">
        {fresh.length === 0 && (
          <li className="inbox-empty">
            <p className="card-empty">Nothing new since you last looked.</p>
          </li>
        )}
        {sorted
          ? GROUPS.map(({ category, label }) => {
              const group = fresh.filter((e) => sorted.get(e.id)?.category === category)
              if (group.length === 0) return null
              return category === 'ignore' ? (
                <Collapsible key={category} id={category} label={label} count={group.length}>
                  {group.map(row)}
                </Collapsible>
              ) : (
                [
                  <li key={`h-${category}`} className={`inbox-group is-${category}`}>
                    <h3>
                      {label} · {group.length}
                    </h3>
                  </li>,
                  ...group.map(row),
                ]
              )
            })
          : fresh.map(row)}
        {seen.length > 0 && (
          <Collapsible id="viewed" label="Previously viewed" count={seen.length}>
            {seen.map(row)}
          </Collapsible>
        )}
      </ul>
    </>
  )
}

/** A group header that shows/hides its rows (collapsed by default). */
function Collapsible({ id, label, count, children }: { id: string; label: string; count: number; children: ReactNode }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <>
      <li className={`inbox-group is-${id}`}>
        <button type="button" className="inbox-group-toggle" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
          <span>
            {label} · {count}
          </span>
          <span className="inbox-group-action">{expanded ? 'Hide' : 'Show'}</span>
        </button>
      </li>
      {expanded && children}
    </>
  )
}

function EmailRow({ email, reason, onOpen }: { email: Email; reason?: string; onOpen: (e: Email) => void }) {
  return (
    <button type="button" className="email" onClick={() => onOpen(email)} aria-haspopup="dialog">
      <span className="email-from">{email.from}</span>
      <span className="email-time">{formatReceived(email.received)}</span>
      <span className="email-subject">{email.subject}</span>
      {reason && <span className="email-reason">{reason}</span>}
      {email.snippet && <span className="email-snippet">{email.snippet}</span>}
    </button>
  )
}
