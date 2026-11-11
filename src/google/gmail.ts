import { googleFetch } from './googleFetch'

export const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me'

export type Header = { name: string; value: string }

export function getHeader(headers: Header[] | undefined, name: string): string {
  return headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? ''
}

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

/** True for addresses at ft.com or any subdomain (news.ft.com, email.ft.com …). */
export function isFtAddress(address: string): boolean {
  const domain = address.split('@')[1]?.toLowerCase() ?? ''
  return domain === 'ft.com' || domain.endsWith('.ft.com')
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

// ---- Full message body (format=full) ----

type Part = {
  mimeType?: string
  filename?: string
  headers?: Header[]
  body?: { size?: number; data?: string; attachmentId?: string }
  parts?: Part[]
}

export type MessageBody = { html: string | null; text: string | null }

function base64UrlToBytes(data: string): Uint8Array {
  const b64 = data.replace(/-/g, '+').replace(/_/g, '/')
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))
}

function decodeText(bytes: Uint8Array, contentType: string): string {
  const charset = contentType.match(/charset\s*=\s*"?([^";\s]+)/i)?.[1] ?? 'utf-8'
  try {
    return new TextDecoder(charset).decode(bytes)
  } catch {
    return new TextDecoder('utf-8').decode(bytes) // unknown charset label
  }
}

/** Depth-first: first non-attachment text/html and text/plain parts in the MIME tree. */
function findBodyParts(part: Part, found: { html?: Part; text?: Part } = {}) {
  if (part.parts?.length) {
    for (const child of part.parts) findBodyParts(child, found)
    return found
  }
  const isAttachment = !!part.filename || /^\s*attachment/i.test(getHeader(part.headers, 'Content-Disposition'))
  if (isAttachment) return found
  if (part.mimeType === 'text/html' && !found.html) found.html = part
  if (part.mimeType === 'text/plain' && !found.text) found.text = part
  return found
}

async function readPart(messageId: string, part: Part, token: string, signal: AbortSignal): Promise<string> {
  let data = part.body?.data
  // Large bodies aren't inlined; Gmail stores them like an attachment.
  if (!data && part.body?.attachmentId) {
    const att = await googleFetch<{ data?: string }>(
      `${GMAIL}/messages/${messageId}/attachments/${part.body.attachmentId}`,
      token,
      signal,
    )
    data = att.data
  }
  if (!data) return ''
  return decodeText(base64UrlToBytes(data), getHeader(part.headers, 'Content-Type'))
}

/** Fetch a message's body, preferring HTML and falling back to plain text. Read-only: doesn't mark as read. */
export async function loadMessageBody(messageId: string, token: string, signal: AbortSignal): Promise<MessageBody> {
  const msg = await googleFetch<{ payload?: Part }>(`${GMAIL}/messages/${messageId}?format=full`, token, signal)
  const { html, text } = msg.payload ? findBodyParts(msg.payload) : {}
  if (html) return { html: await readPart(messageId, html, token, signal), text: null }
  if (text) return { html: null, text: await readPart(messageId, text, token, signal) }
  return { html: null, text: null }
}
