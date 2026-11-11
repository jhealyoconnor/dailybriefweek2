// WMO weather interpretation codes, as used by Open-Meteo.
export function describeCode(code: number, isDay: boolean): { label: string; icon: string } {
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
