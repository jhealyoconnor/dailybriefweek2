import { useFetch } from '../hooks/useFetch'
import { describeCode } from '../weather/codes'
import type { HourlyInput } from '../weather/hourly'
import { CardError } from './CardError'
import { HourlyBar } from './HourlyBar'

// forecast_days=2 so the bar can run into tomorrow morning late in the evening.
const WEATHER_URL =
  'https://api.open-meteo.com/v1/forecast' +
  '?latitude=53.3498&longitude=-6.2603' +
  '&current=temperature_2m,apparent_temperature,weather_code,is_day' +
  '&hourly=temperature_2m,weather_code,precipitation_probability,is_day' +
  '&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset' +
  '&timezone=Europe%2FDublin&forecast_days=2'

type Weather = {
  temperature: number
  feelsLike: number
  code: number
  isDay: boolean
  high: number
  low: number
  /** null if the hourly part of the response is missing or malformed (the card still shows). */
  hourly: HourlyInput | null
}

type Raw = {
  current?: { time?: string; temperature_2m?: number; apparent_temperature?: number; weather_code?: number; is_day?: number }
  hourly?: {
    time?: string[]
    temperature_2m?: (number | null)[]
    weather_code?: (number | null)[]
    precipitation_probability?: (number | null)[]
    is_day?: (number | null)[]
  }
  daily?: { temperature_2m_max?: number[]; temperature_2m_min?: number[]; sunrise?: string[]; sunset?: string[] }
}

function parseHourly(j: Raw, current: { temp: number; code: number; isDay: boolean }): HourlyInput | null {
  const h = j.hourly
  const now = j.current?.time
  const time = h?.time
  if (!h || !now || !Array.isArray(time) || time.length === 0) return null
  const n = time.length
  const nums = (a: unknown) => Array.isArray(a) && a.length === n
  if (!nums(h.temperature_2m) || !nums(h.weather_code) || !nums(h.is_day)) return null
  // Hours with missing temperature/code can't be shown; drop the bar rather than show gaps.
  if (h.temperature_2m!.some((v) => v == null) || h.weather_code!.some((v) => v == null)) return null
  return {
    now,
    current,
    hourly: {
      time,
      temp: h.temperature_2m as number[],
      code: h.weather_code as number[],
      rain: nums(h.precipitation_probability) ? h.precipitation_probability! : time.map(() => null),
      isDay: h.is_day!.map((v) => v !== 0),
    },
    sunrise: j.daily?.sunrise ?? [],
    sunset: j.daily?.sunset ?? [],
  }
}

function parseWeather(json: unknown): Weather {
  const j = json as Raw
  const c = j.current
  const high = j.daily?.temperature_2m_max?.[0]
  const low = j.daily?.temperature_2m_min?.[0]
  if (!c || c.temperature_2m == null || c.weather_code == null || high == null || low == null) {
    throw new Error('Unexpected weather data')
  }
  const isDay = c.is_day !== 0
  return {
    temperature: c.temperature_2m,
    feelsLike: c.apparent_temperature ?? c.temperature_2m,
    code: c.weather_code,
    isDay,
    high,
    low,
    hourly: parseHourly(j, { temp: c.temperature_2m, code: c.weather_code, isDay }),
  }
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
        <div aria-busy="true">
          <div className="weather">
            <div>
              <div className="skeleton skeleton-temp" />
              <div className="skeleton skeleton-line" style={{ width: '60%' }} />
            </div>
            <div className="skeleton skeleton-icon" />
          </div>
          <div className="skeleton skeleton-line hourly-skeleton-summary" />
          <div className="skeleton hourly-skeleton-strip" />
        </div>
      ) : error && !data ? (
        <CardError message="Couldn't load the weather." onRetry={retry} />
      ) : data ? (
        <>
          <WeatherBody weather={data} />
          {data.hourly && <HourlyBar weather={data.hourly} />}
        </>
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
