import { useGoogleAuth } from './auth/useGoogleAuth'
import { AssistantCard } from './components/AssistantCard'
import { CalendarCard } from './components/CalendarCard'
import { DeadlinesCard } from './components/DeadlinesCard'
import { FTSection } from './components/FTSection'
import { Greeting } from './components/Greeting'
import { InboxCard } from './components/InboxCard'
import { ScheduleCard } from './components/ScheduleCard'
import { SignInButton } from './components/SignInButton'
import { WeatherCard } from './components/WeatherCard'
import { useBlackboard } from './hooks/useBlackboard'

export default function App() {
  const { token } = useGoogleAuth()

  return (
    <main className="app">
      <Greeting />
      {token && <AssistantCard token={token} />}
      <WeatherCard />
      {token ? (
        <>
          <SignedInCards token={token} />
          <SignInButton />
        </>
      ) : (
        <SignInButton />
      )}
      <footer className="footer">
        Weather: Open-Meteo · Mail &amp; Calendar: Google · Lectures: Blackboard · News: your FT newsletters · Summaries:
        Gemini
      </footer>
    </main>
  )
}

function SignedInCards({ token }: { token: string }) {
  const blackboard = useBlackboard(token) // one request, shared by both Blackboard cards
  return (
    <>
      <ScheduleCard state={blackboard} />
      <CalendarCard token={token} />
      <DeadlinesCard state={blackboard} />
      <InboxCard token={token} />
      <FTSection token={token} />
    </>
  )
}
