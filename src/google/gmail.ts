import { isFtAddress } from '../../shared/ftClassify'
import { extractBody, getHeader, type Header, type MessageBody, type MimePart } from '../../shared/mime'
import { googleFetch } from './googleFetch'

export { getHeader, isFtAddress, type Header, type MessageBody }

export const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me'

/** `"Jane Doe" <jane@x.com>` → { name: 'Jane Doe', address: 'jane@x.com' }. */
export function parseAddress(from: string): { name: string; address: string } {
  const match = from.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/)
  if (!match) {
    const raw = from.trim()
    return { name: raw || 'Unknown sender', address: raw.includes('@') ? raw : '' }
  }
  const address = match[2].trim()
  return { name: match[1].trim() || address, address }
}

// Gmail snippets contain HTML entities (&#39; etc.). DOMParser decodes without running anything.
export function decodeEntities(text: string): string {
  return new DOMParser().parseFromString(text, 'text/html').documentElement.textContent ?? text
}

export function gmailLink(account: string, threadId: string): string {
  return `https://mail.google.com/mail/?authuser=${encodeURIComponent(account)}#inbox/${threadId}`
}

// ---- Listing messages with their headers (format=metadata) ----

export type EmailSummary = {
  id: string
  threadId: string
  from: string
  fromAddress: string
  subject: string
  snippet: string
  received: Date | null
}

type MessageMeta = {
  id: string
  threadId: string
  snippet?: string
  internalDate?: string
  payload?: { headers?: Header[] }
}

function toEmailSummary(m: MessageMeta): EmailSummary {
  const header = (name: string) => getHeader(m.payload?.headers, name)
  let received: Date | null = header('Date') ? new Date(header('Date')) : null
  if (!received || Number.isNaN(received.getTime())) {
    received = m.internalDate ? new Date(Number(m.internalDate)) : null
  }
  const sender = parseAddress(header('From'))
  return {
    id: m.id,
    threadId: m.threadId,
    from: sender.name,
    fromAddress: sender.address,
    subject: header('Subject').trim() || '(no subject)',
    snippet: decodeEntities(m.snippet ?? ''),
    received,
  }
}

/** Run `fn` over `items` with at most `limit` in flight (keeps Gmail's rate limits happy). */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

/** Search Gmail and return each match's sender/subject/date/snippet, newest first. */
export async function searchEmails(
  query: string,
  max: number,
  token: string,
  signal: AbortSignal,
): Promise<EmailSummary[]> {
  const list = await googleFetch<{ messages?: { id: string }[] }>(
    `${GMAIL}/messages?q=${encodeURIComponent(query)}&maxResults=${max}`,
    token,
    signal,
  )
  const metadata = 'format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date'
  const metas = await mapLimit(list.messages ?? [], 8, (m) =>
    googleFetch<MessageMeta>(`${GMAIL}/messages/${m.id}?${metadata}`, token, signal),
  )
  return metas.map(toEmailSummary)
}

export async function loadAccountEmail(token: string, signal: AbortSignal): Promise<string> {
  return (await googleFetch<{ emailAddress: string }>(`${GMAIL}/profile`, token, signal)).emailAddress
}

// ---- Full message body (format=full); MIME decoding lives in shared/mime.ts ----

/** Fetch a message's body, preferring HTML and falling back to plain text. Read-only: doesn't mark as read. */
export async function loadMessageBody(messageId: string, token: string, signal: AbortSignal): Promise<MessageBody> {
  const msg = await googleFetch<{ payload?: MimePart }>(`${GMAIL}/messages/${messageId}?format=full`, token, signal)
  return extractBody(msg.payload, async (attachmentId) => {
    const att = await googleFetch<{ data?: string }>(`${GMAIL}/messages/${messageId}/attachments/${attachmentId}`, token, signal)
    return att.data
  })
}
