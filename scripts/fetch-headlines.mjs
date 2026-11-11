// Fetches the RTÉ News RSS feed and writes the top 5 stories to
// public/headlines.json. Runs before `npm run dev` and `npm run build`.
// RTÉ's feed has no CORS headers, so the browser can't read it directly;
// generating a static JSON file side-steps that with no proxy or API key.
// Uses Node built-ins only.
import { mkdir, writeFile } from 'node:fs/promises'

const FEED_URL = 'https://www.rte.ie/feeds/rss/?index=/news/'
const OUT_FILE = new URL('../public/headlines.json', import.meta.url)
const LIMIT = 5

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function decode(text) {
  return text
    .replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (match, name) => ENTITIES[name.toLowerCase()] ?? match)
    .trim()
}

function tag(xml, name) {
  const match = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))
  return match ? decode(match[1]) : ''
}

async function main() {
  let payload
  try {
    const res = await fetch(FEED_URL, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) throw new Error(`RTÉ feed responded ${res.status}`)
    const xml = await res.text()
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)]
      .slice(0, LIMIT)
      .map(([, item]) => ({
        title: tag(item, 'title'),
        link: tag(item, 'link'),
        category: tag(item, 'category'),
        publishedAt: new Date(tag(item, 'pubDate')).toISOString(),
      }))
      .filter((item) => item.title && item.link.startsWith('https://'))
    if (items.length === 0) throw new Error('No stories found in RTÉ feed')
    payload = { fetchedAt: new Date().toISOString(), items }
    console.log(`headlines: wrote ${items.length} stories`)
  } catch (err) {
    // Never fail the build: the card shows its error state instead.
    payload = { fetchedAt: new Date().toISOString(), error: String(err?.message ?? err), items: [] }
    console.warn(`headlines: ${payload.error}`)
  }
  await mkdir(new URL('.', OUT_FILE), { recursive: true })
  await writeFile(OUT_FILE, JSON.stringify(payload, null, 2) + '\n')
}

main()
