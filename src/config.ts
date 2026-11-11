// Public OAuth client ID (safe to ship in the browser — there is no client secret).
export const GOOGLE_CLIENT_ID = '507092657827-98sfdddeh39asedih4ej836r4ukf5k6u.apps.googleusercontent.com'

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar.readonly',
  // Lets the Worker confirm (via Google's tokeninfo) which account the token belongs to.
  'https://www.googleapis.com/auth/userinfo.email',
]

export const TIME_ZONE = 'Europe/Dublin'

// FT newsletter list: edit it in shared/ftConfig.ts (shared with the Worker's assistant).
export { FT_ALERT_MATCH, FT_NEWSLETTERS } from '../shared/ftConfig'

// The Cloudflare Worker (worker/) that holds the Gemini key and Blackboard feed URL.
// Not secret: it only answers requests carrying your Google sign-in.
export const WORKER_URL = import.meta.env.DEV
  ? 'http://localhost:8787'
  : 'https://dailybrief-api.healyocj.workers.dev'
