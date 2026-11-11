/*
 * Newsletter HTML → plain text for the FT summary. DOMParser builds an inert
 * document (no scripts run, no images load), so this is safe on untrusted HTML.
 */

import { tidy, trimNewsletter } from '../../shared/text'

export { tidy, trimNewsletter }

const BLOCKS = 'p,div,li,tr,h1,h2,h3,h4,h5,h6,table,blockquote,section,article,header,footer,ul,ol'
export function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('script, style, head, noscript, img, svg, video, audio, iframe, object').forEach((el) => el.remove())
  doc.querySelectorAll('br').forEach((br) => br.replaceWith('\n'))
  doc.querySelectorAll(BLOCKS).forEach((el) => el.append('\n'))
  return tidy(doc.body?.textContent ?? '')
}
