// Shared by the app and the Worker: tidying newsletter text. No DOM.

// Invisible characters newsletters use to pad their preview text. Built from code points so the
// source file contains no invisible characters itself.
const INVISIBLE_RANGES: [number, number][] = [
  [0xad, 0xad], [0x34f, 0x34f], [0x61c, 0x61c], [0x115f, 0x1160], [0x17b4, 0x17b5], [0x180e, 0x180e],
  [0x200b, 0x200f], [0x2028, 0x202f], [0x2060, 0x206f], [0xfeff, 0xfeff],
]
const hex = (n: number) => n.toString(16).padStart(4, '0')
const INVISIBLE = new RegExp(`[${INVISIBLE_RANGES.map(([a, b]) => `\\u${hex(a)}-\\u${hex(b)}`).join('')}]`, 'g')
const NBSP = new RegExp('\\u00a0', 'g')

// Where newsletter boilerplate usually starts; only cut there if it's in the back half.
const FOOTER = /\n[^\n]*(unsubscribe|manage (your )?(newsletters|preferences|email)|you are receiving this|you received this|update your preferences|view (it )?in (your )?browser)[^\n]*/i

export function tidy(text: string): string {
  return text
    .replace(INVISIBLE, '')
    .replace(NBSP, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Drop the footer, then cut to `max` characters at a paragraph or sentence boundary. */
export function trimNewsletter(text: string, max = 6000): string {
  const footer = text.match(FOOTER)
  if (footer?.index && footer.index > text.length / 2) text = text.slice(0, footer.index).trim()
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const boundary = Math.max(cut.lastIndexOf('\n\n'), cut.lastIndexOf('. '))
  return `${cut.slice(0, boundary > max * 0.6 ? boundary + 1 : max).trim()}…`
}

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', pound: '£', euro: '€', copy: '©', reg: '®', trade: '™',
}

/** Decode HTML entities without a DOM (Worker side). */
export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m
    }
    return NAMED[e.toLowerCase()] ?? m
  })
}

const BLOCK_TAGS = 'p|div|li|tr|h[1-6]|table|blockquote|section|article|header|footer|ul|ol|br|hr|td'

/**
 * HTML → plain text without a DOM (the Worker has none). Only ever sent to Gemini,
 * never rendered, so a regex pass is enough: drop non-content elements, turn block
 * boundaries into newlines, strip tags, decode entities.
 */
export function htmlToPlainText(html: string): string {
  const text = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|head|noscript|svg|title)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(new RegExp(`<\\/?(${BLOCK_TAGS})\\b[^>]*>`, 'gi'), '\n')
    .replace(/<[^>]+>/g, '')
  return tidy(decodeHtmlEntities(text))
}
