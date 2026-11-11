// Shared by the app and the Worker: which FT emails are newsletters, alerts or other.
import { FT_ALERT_MATCH, FT_NEWSLETTERS } from './ftConfig'

export type Sender = { from: string; fromAddress: string; subject: string }

const has = (haystack: string, needle: string) => haystack.toLowerCase().includes(needle.toLowerCase())

/** True for addresses at ft.com or any subdomain (news.ft.com, email.ft.com …). */
export function isFtAddress(address: string): boolean {
  const domain = address.split('@')[1]?.toLowerCase() ?? ''
  return domain === 'ft.com' || domain.endsWith('.ft.com')
}

/** Which configured newsletter an email is, by sender name or subject. */
export function newsletterFor(email: Sender): string | null {
  for (const n of FT_NEWSLETTERS) {
    const phrases = [n.name, ...(n.match ?? [])]
    if (phrases.some((p) => has(email.from, p) || has(email.subject, p))) return n.name
  }
  return null
}

function isAlert(email: Sender, subjectToo: boolean): boolean {
  return FT_ALERT_MATCH.some(
    (p) => has(email.from, p) || has(email.fromAddress.split('@')[0] ?? '', p) || (subjectToo && has(email.subject, p)),
  )
}

export type FtKind = { kind: 'newsletter'; name: string } | { kind: 'alert' } | { kind: 'other' } | { kind: 'not-ft' }

/**
 * Alert senders win (an alert can mention a newsletter's name); then newsletters;
 * then alert subjects; anything else from ft.com is "other".
 */
export function classifyFtEmail(email: Sender): FtKind {
  if (!isFtAddress(email.fromAddress)) return { kind: 'not-ft' } // searches can match look-alike senders
  if (isAlert(email, false)) return { kind: 'alert' }
  const name = newsletterFor(email)
  if (name) return { kind: 'newsletter', name }
  if (isAlert(email, true)) return { kind: 'alert' }
  return { kind: 'other' }
}
