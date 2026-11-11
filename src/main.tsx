import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { consumeRedirectResult } from './auth/googleAuth'
import './index.css'

// Home Screen sign-in returns here with the token in the URL fragment; take it and wipe the URL.
consumeRedirectResult()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
