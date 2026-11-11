// Minimal types for the parts of Google Identity Services (accounts.google.com/gsi/client) we use.

declare namespace google.accounts.oauth2 {
  interface TokenResponse {
    access_token: string
    expires_in: number
    scope: string
    token_type: string
    error?: string
    error_description?: string
  }

  interface ClientConfigError {
    type: 'popup_failed_to_open' | 'popup_closed' | 'unknown'
    message?: string
  }

  interface TokenClientConfig {
    client_id: string
    scope: string
    callback: (response: TokenResponse) => void
    error_callback?: (error: ClientConfigError) => void
    include_granted_scopes?: boolean
    prompt?: '' | 'none' | 'consent' | 'select_account'
  }

  interface TokenClient {
    requestAccessToken(overrides?: { prompt?: TokenClientConfig['prompt'] }): void
  }

  function initTokenClient(config: TokenClientConfig): TokenClient
  function hasGrantedAllScopes(response: TokenResponse, ...scopes: string[]): boolean
  function revoke(accessToken: string, done?: () => void): void
}

interface Window {
  google?: typeof google
}

interface Navigator {
  /** iOS Safari: true when launched from the Home Screen. */
  standalone?: boolean
}
