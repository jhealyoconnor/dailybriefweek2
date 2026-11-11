import { workerFetch } from '../api/worker'
import { classifyFtEmail } from '../../shared/ftClassify'
import { FT_NEWSLETTERS } from '../config'
import { dublinYesterdayMorning, isDublinToday } from './dublinTime'
import { loadAccountEmail, loadMessageBody, mapLimit, searchEmails, type EmailSummary } from './gmail'
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

export function classifyFt(emails: EmailSummary[]): Omit<FtData, 'account'> {
  const byName = new Map<string, EmailSummary[]>(FT_NEWSLETTERS.map((n) => [n.name, []]))
  const alerts: EmailSummary[] = []
  const other: EmailSummary[] = []
  for (const email of emails) {
    const c = classifyFtEmail(email)
    if (c.kind === 'alert') alerts.push(email)
    else if (c.kind === 'newsletter') byName.get(c.name)!.push(email)
    else if (c.kind === 'other') other.push(email)
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

type DigestResponse = { briefing: FtDigest['briefing']; summaries: { id: string; summary: string }[] }
const toDigest = (res: DigestResponse): FtDigest => ({
  briefing: res.briefing,
  summaries: new Map(res.summaries.map((s) => [s.id, s.summary])),
})

/**
 * The Worker builds the digest at most once a day. Ask for today's first; only if it doesn't
 * exist yet, fetch the newsletter bodies, convert them to trimmed plain text and send them.
 */
export async function loadFtDigest(data: FtData, token: string, signal: AbortSignal): Promise<FtDigest | null> {
  const recent = recentIssues(data)
  if (recent.length === 0) return null

  const today = await workerFetch<Partial<DigestResponse> & { cached: boolean }>('/ft-digest', token, signal)
  if (today.cached && today.briefing && today.summaries) return toDigest(today as DigestResponse)

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
  return toDigest(await workerFetch<DigestResponse>('/ft-digest', token, signal, { issues: withText }))
}
