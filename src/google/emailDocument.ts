/*
 * Turns an email's HTML into a self-contained document for a sandboxed iframe.
 *
 * Safety comes from the iframe itself (sandbox without allow-scripts or
 * allow-same-origin). On top of that we strip scripts/handlers/embeds, and add
 * a Content-Security-Policy that blocks every network request unless the user
 * taps "Load images" — which also blocks tracking pixels and remote CSS/fonts.
 */

export type PreparedEmail = {
  /** Serialized document with a CSP placeholder; pass to `emailSrcdoc`. */
  template: string
  placeholder: string
  hasRemoteImages: boolean
  /** The email sets its own colours, so it's shown on a light "paper" panel. */
  styled: boolean
}

const REMOTE_IMAGE = /(?:\ssrc|\sbackground|\ssrcset)\s*=\s*["']?\s*(?:https?:)?\/\/|url\(\s*['"]?\s*(?:https?:)?\/\//i
const SETS_COLOURS = /\sbgcolor\s*=|\scolor\s*=|background(?:-color)?\s*:|(?:^|[^-\w])color\s*:/i

const BASE_CSS = `
  html { -webkit-text-size-adjust: 100%; }
  body {
    margin: 0;
    padding: 16px;
    font: 16px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    overflow-wrap: anywhere;
  }
  img { max-width: 100%; height: auto; }
  table { max-width: 100%; }
  pre { white-space: pre-wrap; }
  blockquote { margin-left: 0; padding-left: 12px; border-left: 3px solid rgba(127,127,127,.4); }
`
// Plain-ish emails: light text straight on the dark sheet.
const DARK_CSS = `
  :root { color-scheme: dark; }
  html, body { background: transparent; color: #ebebf5; }
  a { color: #7cc6ff; }
`
// Emails with their own colours: keep their design, on white.
const LIGHT_CSS = `
  :root { color-scheme: light; }
  html, body { background: #fff; color: #1c1c1e; }
`

export function prepareEmail(html: string): PreparedEmail {
  const doc = new DOMParser().parseFromString(html, 'text/html')

  doc.querySelectorAll('script, iframe, frame, frameset, object, embed, applet, base, meta[http-equiv], link').forEach((el) =>
    el.remove(),
  )
  doc.querySelectorAll('*').forEach((el) => {
    for (const attr of [...el.attributes]) {
      if (attr.name.toLowerCase().startsWith('on')) el.removeAttribute(attr.name)
    }
  })
  doc.querySelectorAll('a[href]').forEach((a) => {
    if (/^\s*javascript:/i.test(a.getAttribute('href') ?? '')) a.removeAttribute('href')
    a.setAttribute('target', '_blank')
    a.setAttribute('rel', 'noopener noreferrer')
  })

  const styled = SETS_COLOURS.test(html)
  const placeholder = `csp-${crypto.randomUUID()}`
  const head = doc.head

  const style = doc.createElement('style')
  style.textContent = BASE_CSS + (styled ? LIGHT_CSS : DARK_CSS)
  head.prepend(style) // before the email's own styles, so those still win

  const base = doc.createElement('base')
  base.setAttribute('target', '_blank')
  head.prepend(base)

  const referrer = doc.createElement('meta')
  referrer.setAttribute('name', 'referrer')
  referrer.setAttribute('content', 'no-referrer')
  head.prepend(referrer)

  const csp = doc.createElement('meta')
  csp.setAttribute('http-equiv', 'Content-Security-Policy')
  csp.setAttribute('content', placeholder)
  head.prepend(csp) // must be first so it applies to everything after it

  return {
    template: `<!doctype html>${doc.documentElement.outerHTML}`,
    placeholder,
    hasRemoteImages: REMOTE_IMAGE.test(html),
    styled,
  }
}

export function emailSrcdoc(email: PreparedEmail, loadImages: boolean): string {
  const img = loadImages ? 'data: https: http:' : 'data:'
  const policy = `default-src 'none'; style-src 'unsafe-inline'; img-src ${img}; font-src data:`
  return email.template.replace(email.placeholder, policy)
}
