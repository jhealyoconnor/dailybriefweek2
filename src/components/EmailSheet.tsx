import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { TIME_ZONE } from '../config'
import { emailSrcdoc, prepareEmail } from '../google/emailDocument'
import { gmailLink, loadMessageBody } from '../google/gmail'
import { useGoogleQuery } from '../hooks/useGoogleQuery'
import { CardError } from './CardError'

export type EmailSummary = {
  id: string
  threadId: string
  from: string
  fromAddress: string
  subject: string
  received: Date | null
}

type Props = { token: string; account: string; email: EmailSummary; onClose: () => void }

const fullDate = new Intl.DateTimeFormat('en-IE', {
  timeZone: TIME_ZONE,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export function EmailSheet({ token, account, email, onClose }: Props) {
  const [closing, setClosing] = useState(false)
  const closeButton = useRef<HTMLButtonElement>(null)
  const { data, loading, error, retry } = useGoogleQuery(
    token,
    (t, signal) => loadMessageBody(email.id, t, signal),
    email.id,
  )

  const close = () => (reducedMotion() ? onClose() : setClosing(true))

  // Lock page scroll, focus the close button, close on Escape, restore focus afterwards.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'
    closeButton.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = overflow
      document.removeEventListener('keydown', onKey)
      opener?.focus?.()
    }
  }, [])

  return createPortal(
    <div className={`sheet-backdrop${closing ? ' is-closing' : ''}`} onClick={close}>
      <div
        className={`sheet${closing ? ' is-closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sheet-subject"
        onClick={(e) => e.stopPropagation()}
        onAnimationEnd={(e) => closing && e.target === e.currentTarget && onClose()}
      >
        <div className="sheet-bar">
          <a className="sheet-gmail" href={gmailLink(account, email.threadId)} target="_blank" rel="noopener noreferrer">
            Open in Gmail ↗
          </a>
          <button ref={closeButton} type="button" className="sheet-close" onClick={close} aria-label="Close">
            ✕
          </button>
        </div>

        <header className="sheet-header">
          <p className="sheet-from">
            {email.from}
            {email.fromAddress && email.fromAddress !== email.from && (
              <span className="sheet-address"> {email.fromAddress}</span>
            )}
          </p>
          <h2 id="sheet-subject" className="sheet-subject">
            {email.subject}
          </h2>
          {email.received && <p className="sheet-date">{fullDate.format(email.received)}</p>}
        </header>

        <div className="sheet-body">
          {loading && !data ? (
            <div className="sheet-loading" aria-busy="true">
              {['92%', '80%', '88%', '60%', '75%'].map((w, i) => (
                <div key={i} className="skeleton skeleton-line" style={{ width: w }} />
              ))}
            </div>
          ) : error && !data ? (
            <div className="sheet-padded">
              <CardError message="Couldn't load this email." onRetry={retry} />
            </div>
          ) : data?.html ? (
            <HtmlBody html={data.html} subject={email.subject} />
          ) : data?.text ? (
            <TextBody text={data.text} />
          ) : data ? (
            <p className="sheet-padded card-empty">This email has no readable text.</p>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  )
}

function HtmlBody({ html, subject }: { html: string; subject: string }) {
  const [loadImages, setLoadImages] = useState(false)
  const prepared = useMemo(() => prepareEmail(html), [html])
  const srcdoc = useMemo(() => emailSrcdoc(prepared, loadImages), [prepared, loadImages])

  return (
    <>
      {prepared.hasRemoteImages && !loadImages && (
        <div className="sheet-images">
          <span>Images are hidden to protect your privacy.</span>
          <button type="button" className="retry-button" onClick={() => setLoadImages(true)}>
            Load images
          </button>
        </div>
      )}
      <iframe
        className={`sheet-frame${prepared.styled ? ' is-light' : ''}`}
        title={`Email: ${subject}`}
        // No allow-scripts / allow-same-origin: email content can't run code or touch the app.
        // Popups are allowed (and escape the sandbox) only so links open normally in a new tab.
        sandbox="allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer"
        srcDoc={srcdoc}
      />
    </>
  )
}

const URL_PATTERN = /(https?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]'])/g

function TextBody({ text }: { text: string }) {
  const pieces = text.split(URL_PATTERN)
  return (
    <div className="sheet-text">
      {pieces.map((piece, i) =>
        i % 2 === 1 ? (
          <a key={i} href={piece} target="_blank" rel="noopener noreferrer">
            {piece}
          </a>
        ) : (
          piece
        ),
      )}
    </div>
  )
}
