// Shared by the app and the Worker: reading the real sender of forwarded email. No DOM.
//
// The user's Trinity mail is forwarded from Outlook to Gmail, so Gmail's From header is the
// forwarding (tcd.ie) address and the subject starts with "FW:". The original sender and subject
// are in the "From: … Sent: … To: … Subject: …" block that Outlook puts at the top of the body.
// Gmail's snippet starts with that same block, so the cheap path (metadata only) reads it from
// the snippet; the body is only needed for a better preview.

// Forwarded mail is only trusted from these domains, so a stranger can't email the Gmail
// account directly with a fake "From: …@ft.com" block and have it treated as FT.
export const FORWARDING_DOMAINS = ['tcd.ie']

export type Sender = { from: string; fromAddress: string; subject: string }
export type OriginalHeader = { from: string; fromAddress: string; subject: string | null }

const FW_PREFIX = /^\s*((fw|fwd)\s*:\s*)+/i

export function stripFwPrefix(subject: string): string {
  return subject.replace(FW_PREFIX, '').trim() || subject.trim()
}

/** True when the Gmail sender is one of the user's forwarding addresses. */
export function isForwarder(address: string): boolean {
  const domain = address.split('@')[1]?.toLowerCase() ?? ''
  return FORWARDING_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))
}

/** `"Name" <a@b>`, `Name [mailto:a@b]`, `Name <mailto:a@b>` or `a@b` → name + address. */
export function parseSenderValue(value: string): { name: string; address: string } {
  const v = value.replace(/\s+/g, ' ').trim()
  const bracketed = v.match(/^"?(.*?)"?\s*[<[]\s*(?:mailto:)?([^\s<>[\]]+@[^\s<>[\]]+)\s*[>\]]/i)
  if (bracketed) {
    const address = bracketed[2].trim()
    return { name: bracketed[1].trim().replace(/^"|"$/g, '') || address, address }
  }
  const bare = v.match(/[^\s<>[\]"]+@[^\s<>[\]"]+\.[a-z]{2,}/i)
  if (bare) {
    const name = v.replace(bare[0], '').replace(/[<>[\]"]|mailto:/gi, '').trim()
    return { name: name || bare[0], address: bare[0] }
  }
  return { name: v, address: '' }
}

// Header field labels used by Outlook, Gmail and Apple Mail forward blocks.
const LABELS = 'From|Sent|Date|To|Cc|Subject|Reply-To|Importance'
const FIELD = new RegExp(`(?:^|\\s|\\*)(${LABELS}):\\*?\\s*`, 'gi')

/**
 * Find the FIRST forwarded-message header block in `text` (snippet or body as plain text)
 * and return the original sender and subject. Only the first block counts: Outlook writes it
 * at the very top, so anything an email's own content pretends to be comes after it.
 */
export function parseForwardedHeader(text: string): OriginalHeader | null {
  const head = text.slice(0, 2500)
  const fromAt = head.search(/(?:^|\s|\*)From:\*?\s/i)
  if (fromAt < 0) return null
  // Collect the fields that follow, stopping at a repeated field or a blank line after Subject.
  const block = head.slice(fromAt, fromAt + 1200)
  const fields = new Map<string, string>()
  const matches = [...block.matchAll(FIELD)]
  for (let i = 0; i < matches.length; i++) {
    const label = matches[i][1].toLowerCase()
    if (fields.has(label)) break
    const start = (matches[i].index ?? 0) + matches[i][0].length
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? block.length) : block.length
    let value = block.slice(start, end)
    if (label === 'subject') value = value.split(/\n\s*\n|\n/)[0] // subject ends at its line
    fields.set(label, value.trim())
    if (label === 'subject') break
  }
  const fromValue = fields.get('from')
  // A real forward block has From plus at least one of Sent/Date/Subject right after it.
  if (!fromValue || !(fields.has('sent') || fields.has('date') || fields.has('subject'))) return null
  const sender = parseSenderValue(fromValue)
  if (!sender.address) return null
  return { from: sender.name, fromAddress: sender.address, subject: fields.get('subject') || null }
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Text after the forwarded header block. Works on a body (Subject is its own line) and on a
 * one-line snippet when the original `subject` is known (the block ends where it does).
 */
export function afterForwardedHeader(text: string, subject?: string): string {
  const head = text.slice(0, 2500)
  if (subject) {
    const words = subject.trim().split(/\s+/).map(escapeRegExp).join('\\s+')
    const known = head.match(new RegExp(`(?:^|\\s|\\*)Subject:\\*?\\s*${words}`, 'i'))
    if (known?.index !== undefined) return text.slice(known.index + known[0].length).trim()
  }
  const line = head.match(/(?:^|\s|\*)Subject:\*?[^\n]*\n/i)
  if (line?.index !== undefined) return text.slice(line.index + line[0].length).trim()
  return text
}

/** Remove the forwarded header block (it holds the user's own name and address). */
export function stripForwardedHeader(text: string, subject?: string): string {
  if (!parseForwardedHeader(text)) return text
  return afterForwardedHeader(text, subject).replace(/^_{5,}\s*/, '').trim()
}

/**
 * The sender/subject to show and classify. Forwarded mail from a trusted forwarder with a
 * readable header block → the original sender; anything else → as Gmail reports it.
 */
export function resolveSender(email: Sender, text: string): Sender & { forwarded: boolean } {
  if (isForwarder(email.fromAddress)) {
    const original = parseForwardedHeader(text)
    if (original) {
      // Gmail's Subject header is "FW: <original subject>", which is more reliable than the
      // block's Subject line (in a snippet, newlines are gone and it runs into the body).
      const subject = stripFwPrefix(email.subject) || original.subject || email.subject
      return { from: original.from, fromAddress: original.fromAddress, subject, forwarded: true }
    }
  }
  return { ...email, subject: isForwarder(email.fromAddress) ? stripFwPrefix(email.subject) : email.subject, forwarded: false }
}
