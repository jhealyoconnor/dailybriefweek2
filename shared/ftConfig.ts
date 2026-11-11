// Shared by the app (src/) and the Worker (worker/). Plain TypeScript, no DOM.

// ---- FT newsletters ----
// Add or remove newsletters here. An FT email belongs to a newsletter when its sender name or
// subject contains `name` or any of the optional extra `match` phrases (case-insensitive).
export const FT_NEWSLETTERS: { name: string; match?: string[] }[] = [
  { name: 'White House Watch' },
  { name: 'The Week Ahead' },
  { name: 'The AI Shift' },
  { name: 'Unhedged' },
  { name: 'Chris Giles on Central Banks', match: ['Chris Giles', 'Central Banks'] },
  { name: 'FT Edit' },
]
// FT emails whose sender name, sender address or subject contains one of these are alerts.
export const FT_ALERT_MATCH = ['alert']
