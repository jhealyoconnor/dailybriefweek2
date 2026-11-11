import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { WorkerError, workerFetch } from '../api/worker'

type ToolUse = { tool: string; input: Record<string, unknown> }
type AgentReply = { answer: string; toolsUsed: ToolUse[] }
type Message =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string; toolsUsed: ToolUse[] }
  | { role: 'error'; text: string; retry: string }

const SUGGESTIONS = ['Am I free Thursday?', 'What’s due this week?', 'Anything urgent in my email?', 'Summarise today’s FT']
const MAX_HISTORY = 12

// ---- "Checked: calendar (Thu), Blackboard (9–15 Nov)" ----

const dayName = new Intl.DateTimeFormat('en-IE', { weekday: 'short', timeZone: 'UTC' })
const dayMonth = new Intl.DateTimeFormat('en-IE', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const asDate = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T12:00:00Z`) : null)

function formatDays(start: unknown, end: unknown): string {
  const s = asDate(start)
  const e = asDate(end) ?? s
  if (!s || !e) return ''
  if (s.getTime() === e.getTime()) {
    const soon = (s.getTime() - Date.now()) / 86_400_000 < 6
    return soon ? dayName.format(s) : `${dayName.format(s)} ${dayMonth.format(s)}`
  }
  const sameMonth = s.getUTCMonth() === e.getUTCMonth()
  return sameMonth ? `${s.getUTCDate()}–${dayMonth.format(e)}` : `${dayMonth.format(s)}–${dayMonth.format(e)}`
}

function describeTool({ tool, input }: ToolUse): string {
  switch (tool) {
    case 'get_calendar':
      return `calendar (${formatDays(input.start, input.end)})`
    case 'get_blackboard':
      return `Blackboard (${formatDays(input.start, input.end)})`
    case 'get_emails':
      return typeof input.query === 'string' ? `email (“${input.query}”)` : 'email'
    case 'get_weather':
      return `weather (${formatDays(input.day, input.day)})`
    case 'get_ft_briefing':
      return 'FT briefing'
    default:
      return tool
  }
}

const checkedLine = (tools: ToolUse[]) => [...new Set(tools.map(describeTool))].join(', ')

/** Short, friendly reason for a failed request. */
function errorReason(err: unknown): string {
  const status = err instanceof WorkerError ? err.status : 0
  switch (err instanceof WorkerError ? err.code : undefined) {
    case 'ai_busy':
      return 'AI busy, try again in a minute.'
    case 'ai_quota':
      return 'Daily AI limit reached, resets at about 8am.'
    case 'signin_expired':
      return 'Sign-in expired. Sign in again.'
    case 'not_allowed':
      return 'This Google account isn’t allowed.'
    case 'network':
      return 'Can’t reach the assistant. Check your connection.'
  }
  if (status === 401) return 'Sign-in expired. Sign in again.'
  if (status === 429 || status === 503) return 'AI busy, try again in a minute.'
  return 'Sorry, something went wrong. Try again.'
}

// ---- Light formatting for answers: bullets and **bold**, rendered as React text (no HTML injection) ----

function formatAnswer(text: string): ReactNode[] {
  return text.split('\n').map((line, i) => {
    const bullet = /^\s*[*-]\s+/.test(line)
    const body = line.replace(/^\s*[*-]\s+/, '')
    const pieces = body.split(/\*\*(.+?)\*\*/g).map((p, j) => (j % 2 ? <strong key={j}>{p}</strong> : p))
    return (
      <span key={i} className={bullet ? 'chat-line is-bullet' : 'chat-line'}>
        {pieces}
      </span>
    )
  })
}

export function AssistantCard({ token }: { token: string }) {
  const [messages, setMessages] = useState<Message[]>([]) // in memory only: gone on reload
  const [input, setInput] = useState('')
  const [pending, setPending] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => abortRef.current?.abort(), [])
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, pending])

  async function ask(question: string, history: Message[]) {
    const text = question.trim()
    if (!text || pending) return
    const withQuestion: Message[] = [...history, { role: 'user', text }]
    setMessages(withQuestion)
    setInput('')
    setPending(true)
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const turns = withQuestion
        .filter((m): m is Exclude<Message, { role: 'error' }> => m.role !== 'error')
        .map((m) => ({ role: m.role, text: m.text }))
        .slice(-MAX_HISTORY)
      const reply = await workerFetch<AgentReply>('/agent', token, controller.signal, { messages: turns })
      setMessages([...withQuestion, { role: 'assistant', text: reply.answer, toolsUsed: reply.toolsUsed ?? [] }])
    } catch (err) {
      if (controller.signal.aborted) return
      setMessages([...withQuestion, { role: 'error', text: errorReason(err), retry: text }])
    } finally {
      if (!controller.signal.aborted) setPending(false)
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    void ask(input, messages)
  }

  const retry = (index: number, question: string) => {
    // Drop the failed question and its error, then ask again.
    void ask(question, messages.slice(0, index - 1))
  }

  return (
    <section className="card assistant" aria-labelledby="assistant-heading">
      <h2 id="assistant-heading" className="card-label">
        Assistant
      </h2>

      {messages.length > 0 && (
        <div className="chat" ref={listRef} aria-live="polite">
          {messages.map((m, i) =>
            m.role === 'user' ? (
              <p key={i} className="bubble is-user">
                {m.text}
              </p>
            ) : m.role === 'assistant' ? (
              <div key={i} className="bubble-group">
                <p className="bubble is-assistant">{formatAnswer(m.text)}</p>
                {m.toolsUsed.length > 0 && <p className="chat-checked">Checked: {checkedLine(m.toolsUsed)}</p>}
              </div>
            ) : (
              <div key={i} className="bubble is-error" role="alert">
                <span>{m.text}</span>
                <button type="button" className="retry-button" onClick={() => retry(i, m.retry)} disabled={pending}>
                  Try again
                </button>
              </div>
            ),
          )}
          {pending && (
            <p className="bubble is-assistant is-typing" aria-label="Assistant is typing">
              <span />
              <span />
              <span />
            </p>
          )}
        </div>
      )}

      {messages.length === 0 && (
        <div className="chips">
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" className="chip" onClick={() => void ask(s, messages)} disabled={pending}>
              {s}
            </button>
          ))}
        </div>
      )}

      <form className="chat-input" onSubmit={submit}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about your day…"
          aria-label="Ask the assistant"
          enterKeyHint="send"
          maxLength={2000}
        />
        <button type="submit" className="send-button" disabled={pending || !input.trim()} aria-label="Send">
          ↑
        </button>
      </form>
    </section>
  )
}
