/*
 * Hourly timeline + one-line summary for the weather bar. Pure functions, no AI.
 * Open-Meteo (timezone=Europe/Dublin) returns Dublin-local strings like
 * "2026-11-11T14:00", so everything here compares strings: no timezone maths.
 */

export type HourlyInput = {
  now: string // current.time, e.g. "2026-11-11T14:30"
  current: { temp: number; code: number; isDay: boolean }
  hourly: { time: string[]; temp: number[]; code: number[]; rain: (number | null)[]; isDay: boolean[] }
  sunrise: string[] // today's, tomorrow's
  sunset: string[]
}

export type HourItem = {
  kind: 'hour'
  time: string
  label: string // "Now", "15", or the weekday ("Thu") at midnight
  temp: number
  code: number
  isDay: boolean
  rain: number | null // % chance
  isNow: boolean
}
export type SunItem = { kind: 'sunrise' | 'sunset'; time: string; label: string } // label "16:34"
export type TimelineItem = HourItem | SunItem

const WINDOW_HOURS = 24 // now → the same hour tomorrow
const WET = 50 // % chance at which an hour counts as rain
const SOME_CHANCE = 20 // % chance worth mentioning (and showing under the hour)

const hourKey = (t: string) => `${t.slice(0, 13)}:00`
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Local "YYYY-MM-DDTHH:00" shifted by whole hours (UTC arithmetic on the digits only). */
function addHours(key: string, hours: number): string {
  const [d, t] = key.split('T')
  const [y, m, day] = d.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, day, Number(t.slice(0, 2)) + hours)).toISOString().slice(0, 13) + ':00'
}

function weekday(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
}

/** The next 24 hours from now, with sunrise/sunset markers slotted in. */
export function buildTimeline(w: HourlyInput): TimelineItem[] {
  const first = hourKey(w.now)
  const last = addHours(first, WINDOW_HOURS)
  const indexes = w.hourly.time.flatMap((t, i) => (t >= first && t <= last ? [i] : []))
  if (indexes.length === 0) return []

  const sunEvents: SunItem[] = [
    ...w.sunrise.map((time) => ({ kind: 'sunrise' as const, time, label: time.slice(11, 16) })),
    ...w.sunset.map((time) => ({ kind: 'sunset' as const, time, label: time.slice(11, 16) })),
  ]
    .filter((e) => e.time > w.now)
    .sort((a, b) => a.time.localeCompare(b.time))

  const items: TimelineItem[] = []
  indexes.forEach((i, n) => {
    const time = w.hourly.time[i]
    const isNow = n === 0
    items.push({
      kind: 'hour',
      time,
      // Midnight shows the new day's name so it's clear where tomorrow starts.
      label: isNow ? 'Now' : time.slice(11, 13) === '00' ? weekday(time.slice(0, 10)) : time.slice(11, 13),
      // "Now" uses the current conditions so it matches the big number above.
      temp: isNow ? w.current.temp : w.hourly.temp[i],
      code: isNow ? w.current.code : w.hourly.code[i],
      isDay: isNow ? w.current.isDay : w.hourly.isDay[i],
      rain: w.hourly.rain[i] ?? null,
      isNow,
    })
    items.push(...sunEvents.filter((e) => hourKey(e.time) === time))
  })
  return items
}

/** "4pm", "8am", "noon", "midnight"; adds " tomorrow" for times after tonight's midnight. */
export function clockWord(time: string, today: string): string {
  const h = Number(time.slice(11, 13))
  if (h === 0) return 'midnight' // tonight's midnight reads naturally without "tomorrow"
  const word = h === 12 ? 'noon' : h < 12 ? `${h}am` : `${h - 12}pm`
  return time.slice(0, 10) > today ? `${word} tomorrow` : word
}

function precipWord(code: number): string {
  if (code >= 95) return 'Thunderstorms'
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'Snow'
  if (code >= 80 && code <= 82) return 'Showers'
  return 'Rain'
}

const isClear = (code: number) => code <= 1
const isCloudy = (code: number) => code === 2 || code === 3 || code === 45 || code === 48

/** One line describing the next 24 hours, e.g. "Rain likely from 4pm, clearing by 8pm". */
export function summarise(items: TimelineItem[]): string {
  const hours = items.filter((i): i is HourItem => i.kind === 'hour')
  if (hours.length === 0) return ''
  const today = hours[0].time.slice(0, 10)
  const at = (h: HourItem) => clockWord(h.time, today)
  const wet = (h: HourItem) => (h.rain ?? 0) >= WET

  const firstWet = hours.findIndex(wet)
  if (firstWet >= 0) {
    const word = precipWord(hours[firstWet].code)
    const clears = hours.findIndex((h, i) => i > firstWet && !wet(h))
    if (firstWet === 0) {
      return clears >= 0 ? `${word} now, clearing by ${at(hours[clears])}` : `${word} now, continuing into tomorrow`
    }
    // "from 10am tomorrow, clearing by 2pm" — say "tomorrow" once when both times are tomorrow.
    const start = hours[firstWet]
    const sameDay = clears >= 0 && hours[clears].time.slice(0, 10) === start.time.slice(0, 10)
    const clearAt = clears < 0 ? '' : sameDay ? clockWord(hours[clears].time, hours[clears].time.slice(0, 10)) : at(hours[clears])
    return `${word} likely from ${at(start)}${clears >= 0 ? `, clearing by ${clearAt}` : ' onwards'}`
  }

  const peak = hours.reduce((best, h) => ((h.rain ?? 0) > (best.rain ?? 0) ? h : best), hours[0])
  if ((peak.rain ?? 0) >= SOME_CHANCE) {
    return `Mostly dry, small chance of ${precipWord(peak.code).toLowerCase()} around ${at(peak)}`
  }

  const clear = hours.filter((h) => isClear(h.code)).length
  const cloudy = hours.filter((h) => isCloudy(h.code)).length
  const sky = clear > hours.length / 2 ? 'Clear and dry' : cloudy > hours.length / 2 ? 'Cloudy and dry' : 'Dry'
  const coldest = hours.reduce((low, h) => (h.temp < low.temp ? h : low), hours[0])
  return `${sky} for the next 24 hours, low of ${Math.round(coldest.temp)}° around ${at(coldest)}`
}
