import { workerFetch } from '../api/worker'
import { FT_ALERT_MATCH, FT_NEWSLETTERS } from '../config'
import { dublinYesterdayMorning, isDublinToday } from './dublinTime'
import { isFtAddress, loadAccountEmail, loadMessageBody, mapLimit, searchEmails, type EmailSummary } from './gmail'
import { htmlToText, tidy, trimNewsletter } from './htmlText'

export type FtNewsletter = { name: string; issues: EmailSummary[] } // issues newest first
export type FtData = {
  account: string
  newsletters: FtNewsletter[] // in FT_NEWSLETTERS order, including ones with no issues
  alertsToday: EmailSummary[] // newest first
  other: EmailSummary[] // FT emails matching no newsletter and not alerts
}

const FT_QUERY = 'from:ft.com newer_than:7d'
const FT_MAX = 60

const has = (haystack: string, needle: string) => haystack.toLowerCase().includes(needle.toLowerCase())

/** Which configured newsletter an email is, by sender name or subject. */
export function newsletterFor(email: EmailSummary): string | null {
  for (const n of FT_NEWSLETTERS) {
    const phrases = [n.name, ...(n.match ?? [])]
    if (phrases.some((p) => has(email.from, p) || has(email.subject, p))) return n.name
  }
  return null
}

function isAlert(email: EmailSummary, subjectToo: boolean): boolean {
  return FT_ALERT_MATCH.some(
    (p) => has(email.from, p) || has(email.fromAddress.split('@')[0] ?? '', p) || (subjectToo && has(email.subject, p)),
  )
}

export function classifyFt(emails: EmailSummary[]): Omit<FtData, 'account'> {
  const byName = new Map<string, EmailSummary[]>(FT_NEWSLETTERS.map((n) => [n.name, []]))
  const alerts: EmailSummary[] = []
  const other: EmailSummary[] = []
  for (const email of emails) {
    if (!isFtAddress(email.fromAddress)) continue // the search can match look-alike senders
    // Alert senders win (an alert can mention a newsletter's name); then newsletters; then alert subjects.
    if (isAlert(email, false)) alerts.push(email)
    else if (newsletterFor(email)) byName.get(newsletterFor(email)!)!.push(email)
    else if (isAlert(email, true)) alerts.push(email)
    else other.push(email)
  }
  const newest = (a: EmailSummary, b: EmailSummary) => (b.received?.getTime() ?? 0) - (a.received?.getTime() ?? 0)
  return {
    newsletters: FT_NEWSLETTERS.map((n) => ({ name: n.name, issues: byName.get(n.name)!.sort(newest) })),
    alertsToday: alerts.filter((a) => isDublinToday(a.received)).sort(newest),
    other: other.sort(newest),
  }
}

export async function loadFt(token: string, signal: AbortSignal): Promise<FtData> {
  const [emails, account] = await Promise.all([searchEmails(FT_QUERY, FT_MAX, token, signal), loadAccountEmail(token, signal)])
  return { account, ...classifyFt(emails) }
}

// ---- AI digest via the Worker ----

export type FtDigest = {
  briefing: { newsletter: string; what: string; why: string }[]
  summaries: Map<string, string> // message id → 1–2 sentence summary
}

/** Newsletter issues received since 06:00 yesterday (Dublin) — the ones that get summarised. */
export function recentIssues(data: FtData): { newsletter: string; email: EmailSummary }[] {
  const since = dublinYesterdayMorning().getTime()
  return data.newsletters
    .flatMap((n) => n.issues.map((email) => ({ newsletter: n.name, email })))
    .filter(({ email }) => (email.received?.getTime() ?? 0) >= since)
    .slice(0, 12)
}

/** Fetch bodies, convert to trimmed plain text, and ask the Worker for the digest. */
export async function loadFtDigest(data: FtData, token: string, signal: AbortSignal): Promise<FtDigest | null> {
  const recent = recentIssues(data)
  if (recent.length === 0) return null

  const issues = await mapLimit(recent, 3, async ({ newsletter, email }) => {
    const body = await loadMessageBody(email.id, token, signal)
    const text = body.html ? htmlToText(body.html) : tidy(body.text ?? '')
    return {
      id: email.id,
      newsletter,
      subject: email.subject,
      received: email.received?.toISOString() ?? '',
      text: trimNewsletter(text || email.snippet),
    }
  })
  const withText = issues.filter((i) => i.text)
  if (withText.length === 0) return null
  const res = await workerFetch<{ briefing: FtDigest['briefing']; summaries: { id: string; summary: string }[] }>(
    '/ft-digest',
    token,
    signal,
    { issues: withText },
  )
  return { briefing: res.briefing, summaries: new Map(res.summaries.map((s) => [s.id, s.summary])) }
}
