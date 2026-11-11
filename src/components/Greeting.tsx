import { useEffect, useState } from 'react'

const TIME_ZONE = 'Europe/Dublin'

function greetingFor(hour: number): string {
  if (hour < 5) return 'Good night'
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

function describe(now: Date) {
  const hour = Number(
    new Intl.DateTimeFormat('en-IE', { hour: 'numeric', hourCycle: 'h23', timeZone: TIME_ZONE }).format(now),
  )
  const date = new Intl.DateTimeFormat('en-IE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: TIME_ZONE,
  }).format(now)
  return { greeting: greetingFor(hour), date }
}

export function Greeting() {
  // null until the first client-side tick, so the skeleton shows instead of a stale value.
  const [now, setNow] = useState<Date | null>(null)

  useEffect(() => {
    setNow(new Date())
    const id = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(id)
  }, [])

  if (!now) {
    return (
      <header className="greeting" aria-busy="true">
        <div className="skeleton skeleton-line" style={{ width: '45%' }} />
        <div className="skeleton skeleton-title" style={{ width: '75%' }} />
      </header>
    )
  }

  let text: ReturnType<typeof describe>
  try {
    text = describe(now)
  } catch {
    return (
      <header className="greeting">
        <p className="greeting-date">Today</p>
        <h1 className="greeting-title">Hello</h1>
        <p className="greeting-note">Couldn't read today's date on this device.</p>
      </header>
    )
  }

  return (
    <header className="greeting">
      <p className="greeting-date">{text.date}</p>
      <h1 className="greeting-title">{text.greeting}</h1>
    </header>
  )
}
