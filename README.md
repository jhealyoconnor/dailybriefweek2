<div align="center">

# ☀️ Daily Brief

**A personal morning dashboard: weather, lectures, deadlines, inbox, calendar and the FT, with an AI assistant on top.**

[![Live demo](https://img.shields.io/badge/live-jhealyoconnor.github.io-0A84FF?style=for-the-badge)](https://jhealyoconnor.github.io/dailybriefweek2/)

![React](https://img.shields.io/badge/React_19-20232A?logo=react&logoColor=61DAFB)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white)
![Cloudflare Workers](https://img.shields.io/badge/Cloudflare_Workers-F38020?logo=cloudflare&logoColor=white)
![Gemini](https://img.shields.io/badge/Gemini-8E75B2?logo=googlegemini&logoColor=white)
![GitHub Pages](https://img.shields.io/badge/GitHub_Pages-222222?logo=githubpages&logoColor=white)

</div>

---

Week 2 of the Daily Brief build. [Week 1](https://github.com/jhealyoconnor/dailybriefweek1) was a static page with weather and headlines; this version signs in with Google and pulls everything I check each morning onto one Home Screen web app.

## Features

| Card | What it shows |
|---|---|
| **Assistant** | Chat that answers questions like *"what's due this week?"* by calling read-only tools over my calendar, Blackboard, email, weather and FT briefing |
| **Weather** | Current Dublin conditions plus a 24-hour hourly bar (Open-Meteo) |
| **Schedule & Deadlines** | Today's lectures and upcoming assignment deadlines from the Trinity Blackboard calendar feed |
| **Calendar** | Today's Google Calendar events |
| **Inbox** | Recent Gmail with AI triage, including the real sender of mail forwarded from Outlook |
| **FT** | A daily digest of my FT newsletters (Unhedged, White House Watch, Chris Giles…) and any FT alerts |

## Architecture

```
┌──────────────────────────┐        Google sign-in token        ┌──────────────────────────────┐
│  React app (GitHub Pages)│ ─────────────────────────────────▶ │  Cloudflare Worker           │
│  src/                    │                                    │  worker/                     │
│  • Gmail + Calendar APIs │ ◀───────────────────────────────── │  • verifies the Google token │
│    called from browser   │     triage · FT digest · agent     │  • holds Gemini key + feeds  │
└──────────────────────────┘                                    │  • KV cache for AI results   │
             ▲                                                  └──────────────────────────────┘
             └──── shared/  (FT config, MIME decoding, text tidying, weather codes)
```

- **No secrets in the browser.** The OAuth client ID is public; the Gemini key and Blackboard feed URL live only in the Worker, which answers only requests carrying a valid Google token.
- **Built for the Gemini free tier.** Flash-Lite models for bulk work, triage cached per message in KV, the FT digest built at most once a day, and an automatic fallback model when a daily quota runs out.
- **Assistant loop.** Gemini function calling on the Worker, capped at 5 tool rounds; tool output is treated as untrusted input.

## Run it locally

```bash
npm install
npm run dev            # app on http://localhost:5173
```

```bash
cd worker
npm install
npx wrangler dev       # Worker on http://localhost:8787
```

The Worker needs a `.dev.vars` file with its secrets (ignored by git). Pushing to `main` deploys the app to GitHub Pages through `.github/workflows/deploy.yml`.

## Project layout

```
src/         React app: cards, Google auth, Gmail/Calendar helpers, hooks
worker/      Cloudflare Worker: /agent, /triage, FT digest, calendar feed
shared/      Code used by both sides
public/      Icons and web manifest (installable to the iPhone Home Screen)
```
