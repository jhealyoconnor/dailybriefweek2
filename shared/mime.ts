// Shared by the app and the Worker: reading a Gmail message body (format=full). No DOM.

export type Header = { name: string; value: string }

export type MimePart = {
  mimeType?: string
  filename?: string
  headers?: Header[]
  body?: { size?: number; data?: string; attachmentId?: string }
  parts?: MimePart[]
}

export type MessageBody = { html: string | null; text: string | null }

export function getHeader(headers: Header[] | undefined, name: string): string {
  return headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? ''
}

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
function findBodyParts(part: MimePart, found: { html?: MimePart; text?: MimePart } = {}) {
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

/**
 * Pick the body, preferring HTML and falling back to plain text, and decode it.
 * `fetchAttachment` loads large bodies that Gmail stores like attachments.
 */
export async function extractBody(
  payload: MimePart | undefined,
  fetchAttachment: (attachmentId: string) => Promise<string | undefined>,
): Promise<MessageBody> {
  const { html, text } = payload ? findBodyParts(payload) : {}
  const read = async (part: MimePart) => {
    const data = part.body?.data ?? (part.body?.attachmentId ? await fetchAttachment(part.body.attachmentId) : undefined)
    return data ? decodeText(base64UrlToBytes(data), getHeader(part.headers, 'Content-Type')) : ''
  }
  if (html) return { html: await read(html), text: null }
  if (text) return { html: null, text: await read(text) }
  return { html: null, text: null }
}
