import { useMemo } from 'react'
import { describeCode } from '../weather/codes'
import { buildTimeline, summarise, type HourlyInput, type TimelineItem } from '../weather/hourly'

const SHOW_RAIN_FROM = 20 // % chance

function itemLabel(item: TimelineItem): string {
  if (item.kind !== 'hour') return `${item.kind === 'sunrise' ? 'Sunrise' : 'Sunset'} at ${item.label}`
  const { label } = describeCode(item.code, item.isDay)
  const when = item.isNow ? 'Now' : `${item.time.slice(11, 16)}`
  const rain = item.rain != null && item.rain >= SHOW_RAIN_FROM ? `, ${item.rain}% chance of rain` : ''
  return `${when}, ${label}, ${Math.round(item.temp)}°${rain}`
}

export function HourlyBar({ weather }: { weather: HourlyInput }) {
  const items = useMemo(() => buildTimeline(weather), [weather])
  const summary = useMemo(() => summarise(items), [items])
  if (items.length === 0) return null
  // Only reserve the rain line when at least one hour uses it, so columns stay aligned without dead space.
  const anyRain = items.some((i) => i.kind === 'hour' && i.rain != null && i.rain >= SHOW_RAIN_FROM)

  return (
    <div className="hourly">
      {summary && <p className="hourly-summary">{summary}</p>}
      {/* tabIndex so keyboard users can scroll it with the arrow keys */}
      <ul className={`hourly-strip${anyRain ? '' : ' no-rain'}`} aria-label="Hourly forecast" tabIndex={0}>
        {items.map((item) =>
          item.kind === 'hour' ? (
            <li key={item.time} className={`hour${item.isNow ? ' is-now' : ''}`} aria-label={itemLabel(item)}>
              <span className="hour-time" aria-hidden="true">
                {item.label}
              </span>
              <span className="hour-icon" aria-hidden="true">
                {describeCode(item.code, item.isDay).icon}
              </span>
              <span className="hour-temp" aria-hidden="true">
                {Math.round(item.temp)}°
              </span>
              <span className="hour-rain" aria-hidden="true">
                {item.rain != null && item.rain >= SHOW_RAIN_FROM ? `${item.rain}%` : ''}
              </span>
            </li>
          ) : (
            <li key={`${item.kind}-${item.time}`} className="hour is-sun" aria-label={itemLabel(item)}>
              <span className="hour-time" aria-hidden="true">
                {item.label}
              </span>
              <span className="hour-icon" aria-hidden="true">
                {item.kind === 'sunrise' ? '🌅' : '🌇'}
              </span>
              <span className="hour-sun-label" aria-hidden="true">
                {item.kind === 'sunrise' ? 'Sunrise' : 'Sunset'}
              </span>
              <span className="hour-rain" aria-hidden="true" />
            </li>
          ),
        )}
      </ul>
    </div>
  )
}
