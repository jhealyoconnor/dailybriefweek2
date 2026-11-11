import { useFetch } from '../hooks/useFetch'
import { CardError } from './CardError'

const WEATHER_URL =
  'https://api.open-meteo.com/v1/forecast' +
  '?latitude=53.3498&longitude=-6.2603' +
  '&current=temperature_2m,apparent_temperature,weather_code,is_day' +
  '&daily=temperature_2m_max,temperature_2m_min' +
  '&timezone=Europe%2FDublin&forecast_days=1'

type Weather = {
  temperature: number
  feelsLike: number
  code: number
  isDay: boolean
  high: number
  low: number
}

function parseWeather(json: unknown): Weather {
  const j = json as {
    current?: { temperature_2m?: number; apparent_temperature?: number; weather_code?: number; is_day?: number }
    daily?: { temperature_2m_max?: number[]; temperature_2m_min?: number[] }
  }
  const c = j.current
  const high = j.daily?.temperature_2m_max?.[0]
  const low = j.daily?.temperature_2m_min?.[0]
  if (!c || c.temperature_2m == null || c.weather_code == null || high == null || low == null) {
    throw new Error('Unexpected weather data')
  }
  return {
    temperature: c.temperature_2m,
    feelsLike: c.apparent_temperature ?? c.temperature_2m,
    code: c.weather_code,
    isDay: c.is_day !== 0,
    high,
    low,
  }
}

// WMO weather interpretation codes, as used by Open-Meteo.
function describeCode(code: number, isDay: boolean): { label: string; icon: string } {
  if (code === 0) return { label: 'Clear', icon: isDay ? '☀️' : '🌙' }
  if (code === 1) return { label: 'Mostly clear', icon: isDay ? '🌤️' : '🌙' }
  if (code === 2) return { label: 'Partly cloudy', icon: isDay ? '⛅️' : '☁️' }
  if (code === 3) return { label: 'Overcast', icon: '☁️' }
  if (code === 45 || code === 48) return { label: 'Fog', icon: '🌫️' }
  if (code >= 51 && code <= 57) return { label: 'Drizzle', icon: '🌦️' }
  if (code >= 61 && code <= 67) return { label: code >= 65 ? 'Heavy rain' : 'Rain', icon: '🌧️' }
  if (code >= 71 && code <= 77) return { label: 'Snow', icon: '🌨️' }
  if (code >= 80 && code <= 82) return { label: 'Showers', icon: '🌦️' }
  if (code === 85 || code === 86) return { label: 'Snow showers', icon: '🌨️' }
  if (code >= 95) return { label: 'Thunderstorms', icon: '⛈️' }
  return { label: 'Unknown', icon: '🌡️' }
}

const deg = (n: number) => `${Math.round(n)}°`

export function WeatherCard() {
  const { data, loading, error, retry } = useFetch<Weather>(WEATHER_URL, parseWeather)

  return (
    <section className="card" aria-labelledby="weather-heading">
      <h2 id="weather-heading" className="card-label">
        Weather · Dublin
      </h2>

      {loading && !data ? (
        <div className="weather" aria-busy="true">
          <div>
            <div className="skeleton skeleton-temp" />
            <div className="skeleton skeleton-line" style={{ width: '60%' }} />
          </div>
          <div className="skeleton skeleton-icon" />
        </div>
      ) : error && !data ? (
        <CardError message="Couldn't load the weather." onRetry={retry} />
      ) : data ? (
        <WeatherBody weather={data} />
      ) : null}
    </section>
  )
}

function WeatherBody({ weather }: { weather: Weather }) {
  const { label, icon } = describeCode(weather.code, weather.isDay)
  return (
    <div className="weather">
      <div>
        <p className="weather-temp">{deg(weather.temperature)}</p>
        <p className="weather-condition">{label}</p>
        <p className="weather-range">
          H:{deg(weather.high)} · L:{deg(weather.low)} · Feels {deg(weather.feelsLike)}
        </p>
      </div>
      <span className="weather-icon" role="img" aria-label={label}>
        {icon}
      </span>
    </div>
  )
}
