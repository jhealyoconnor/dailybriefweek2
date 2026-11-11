/*
 * Newsletter HTML → plain text for the FT summary. DOMParser builds an inert
 * document (no scripts run, no images load), so this is safe on untrusted HTML.
 */

const BLOCKS = 'p,div,li,tr,h1,h2,h3,h4,h5,h6,table,blockquote,section,article,header,footer,ul,ol'
// Invisible characters newsletters use to pad their preview text.
const INVISIBLE_RANGES: [number, number][] = [
  [0xad, 0xad], [0x34f, 0x34f], [0x61c, 0x61c], [0x115f, 0x1160], [0x17b4, 0x17b5], [0x180e, 0x180e],
  [0x200b, 0x200f], [0x2028, 0x202f], [0x2060, 0x206f], [0xfeff, 0xfeff],
]
const hex = (n: number) => n.toString(16).padStart(4, '0')
const INVISIBLE = new RegExp(`[${INVISIBLE_RANGES.map(([a, b]) => `\\u${hex(a)}-\\u${hex(b)}`).join('')}]`, 'g')
// Where newsletter boilerplate usually starts; only cut there if it's in the back half.
const FOOTER = /\n[^\n]*(unsubscribe|manage (your )?(newsletters|preferences|email)|you are receiving this|you received this|update your preferences|view (it )?in (your )?browser)[^\n]*/i

export function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('script, style, head, noscript, img, svg, video, audio, iframe, object').forEach((el) => el.remove())
  doc.querySelectorAll('br').forEach((br) => br.replaceWith('\n'))
  doc.querySelectorAll(BLOCKS).forEach((el) => el.append('\n'))
  return tidy(doc.body?.textContent ?? '')
}

export function tidy(text: string): string {
  return text
    .replace(INVISIBLE, '')
    .replace(/ /g, ' ')
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
