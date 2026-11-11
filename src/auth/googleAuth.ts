/*
 * In-memory Google sign-in store.
 *
 * - Normal browsers: Google Identity Services token client (popup).
 * - iPhone Home Screen (standalone) apps: popups can't report back to the app,
 *   so we use Google's OAuth 2.0 redirect flow for browser apps instead. The
 *   token comes back in the URL fragment, which we read once and wipe.
 *
 * The access token only ever lives in the `state` variable below — never in
 * localStorage/sessionStorage, and never logged.
 */
import { GOOGLE_CLIENT_ID, GOOGLE_SCOPES } from '../config'

export type AuthStatus = 'signedOut' | 'signingIn' | 'signedIn'

export type AuthState = {
  status: AuthStatus
  token: string | null
  /** True once sign-in can be started (GIS loaded, or standalone redirect mode). */
  ready: boolean
  /** Something went wrong signing in. */
  error: string | null
  /** Informational message, e.g. the session expired. */
  notice: string | null
}

const GIS_SRC = 'https://accounts.google.com/gsi/client'
const STATE_KEY = 'oauth_state' // random CSRF value for the redirect flow (not the token)
const EXPIRY_MARGIN_MS = 60_000

let state: AuthState = { status: 'signedOut', token: null, ready: false, error: null, notice: null }
let expiresAt = 0
let expiryTimer: number | undefined
let tokenClient: google.accounts.oauth2.TokenClient | null = null
let gisPromise: Promise<void> | null = null
const listeners = new Set<() => void>()

function setState(patch: Partial<AuthState>) {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

export function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getSnapshot(): AuthState {
  return state
}

export function isStandalone(): boolean {
  return window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true
}

function redirectUri(): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}`
}

function acceptToken(token: string, expiresInSeconds: number, grantedScope: string) {
  const granted = new Set(grantedScope.split(' '))
  if (!GOOGLE_SCOPES.every((s) => granted.has(s))) {
    setState({
      status: 'signedOut',
      token: null,
      error: 'Please allow access to both Gmail and Calendar, then sign in again.',
      notice: null,
    })
    return
  }
  const lifetimeMs = Math.max(expiresInSeconds * 1000 - EXPIRY_MARGIN_MS, 0)
  expiresAt = Date.now() + lifetimeMs
  window.clearTimeout(expiryTimer)
  expiryTimer = window.setTimeout(() => expire(), lifetimeMs)
  setState({ status: 'signedIn', token, error: null, notice: null })
}

/** Drop the token, e.g. when it times out or Google returns 401. */
export function expire(notice = 'Your Google session expired — sign in again.') {
  if (!state.token) return
  window.clearTimeout(expiryTimer)
  expiresAt = 0
  setState({ status: 'signedOut', token: null, notice, error: null })
}

export function signOut() {
  const token = state.token
  window.clearTimeout(expiryTimer)
  expiresAt = 0
  setState({ status: 'signedOut', token: null, notice: null, error: null })
  if (token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(token)
}

/** Load the GIS script and create the token client. Safe to call repeatedly. */
export function loadGis(): Promise<void> {
  if (gisPromise) return gisPromise
  if (isStandalone()) setState({ ready: true }) // redirect flow doesn't need GIS

  gisPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = GIS_SRC
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Could not load Google sign-in.'))
    document.head.appendChild(script)
  })
    .then(() => {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: GOOGLE_SCOPES.join(' '),
        include_granted_scopes: true,
        callback: (res) => {
          if (res.error || !res.access_token) {
            setState({ status: 'signedOut', error: 'Google sign-in was not completed.' })
            return
          }
          acceptToken(res.access_token, Number(res.expires_in), res.scope)
        },
        error_callback: (err) => {
          setState({
            status: 'signedOut',
            error: err.type === 'popup_failed_to_open' ? 'The sign-in window was blocked. Allow pop-ups and try again.' : null,
          })
        },
      })
      setState({ ready: true })
    })
    .catch((err: unknown) => {
      gisPromise = null
      if (!isStandalone()) setState({ error: err instanceof Error ? err.message : 'Could not load Google sign-in.' })
    })

  return gisPromise
}

/** Must be called directly from a click handler so the popup isn't blocked. */
export function signIn() {
  setState({ error: null, notice: null })

  if (isStandalone()) {
    const csrf = crypto.randomUUID()
    try {
      sessionStorage.setItem(STATE_KEY, csrf)
    } catch {
      setState({ error: 'Sign-in needs website storage enabled for this app.' })
      return
    }
    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: redirectUri(),
      response_type: 'token',
      scope: GOOGLE_SCOPES.join(' '),
      include_granted_scopes: 'true',
      state: csrf,
    })
    setState({ status: 'signingIn' })
    window.location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${params}`)
    return
  }

  if (!tokenClient) {
    setState({ error: 'Google sign-in is still loading — try again in a moment.' })
    return
  }
  setState({ status: 'signingIn' })
  tokenClient.requestAccessToken()
}

/**
 * Redirect flow return leg: if the URL fragment holds an OAuth response, take
 * the token into memory and immediately remove it from the address bar/history.
 * Call once at startup, before rendering.
 */
export function consumeRedirectResult() {
  const hash = window.location.hash.slice(1)
  if (!hash.includes('access_token=') && !hash.includes('error=')) return

  const params = new URLSearchParams(hash)
  window.history.replaceState(null, '', window.location.pathname + window.location.search)

  let expected: string | null = null
  try {
    expected = sessionStorage.getItem(STATE_KEY)
    sessionStorage.removeItem(STATE_KEY)
  } catch {
    // fall through: mismatch below
  }

  if (!expected || params.get('state') !== expected) {
    setState({ error: 'Sign-in could not be verified. Please try again.' })
    return
  }
  const error = params.get('error')
  if (error) {
    setState({ error: error === 'access_denied' ? null : 'Google sign-in was not completed.' })
    return
  }
  const token = params.get('access_token')
  if (token) acceptToken(token, Number(params.get('expires_in') ?? 3600), params.get('scope') ?? '')
}

// Timers can be paused while an iPhone app is in the background; re-check on return.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.token && Date.now() >= expiresAt) expire()
})
