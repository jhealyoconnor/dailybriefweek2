import { Greeting } from './components/Greeting'
import { HeadlinesCard } from './components/HeadlinesCard'
import { WeatherCard } from './components/WeatherCard'

export default function App() {
  return (
    <main className="app">
      <Greeting />
      <WeatherCard />
      <HeadlinesCard />
      <footer className="footer">Weather: Open-Meteo · News: RTÉ</footer>
    </main>
  )
}
