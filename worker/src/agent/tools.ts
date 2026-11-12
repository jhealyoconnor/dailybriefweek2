/*
 * The assistant's tools. All read-only. Each validates its own input, returns only
 * the fields the assistant needs (no email bodies, no event descriptions/attendees),
 * and never logs what it read.
 */
import { classifyFtEmail, isFtAddress } from '../../../shared/ftClassify';
import { resolveSender, stripForwardedHeader } from '../../../shared/forwarded';
import { extractBody, getHeader, type Header, type MimePart } from '../../../shared/mime';
import { decodeHtmlEntities, htmlToPlainText, tidy, trimNewsletter } from '../../../shared/text';
import { describeCode } from '../../../shared/weatherCodes';
import { blackboardRange } from '../calendar';
import { ftDigest, parseDigestInput, todaysDigest, type CachedDigest } from '../ftDigest';
import { addDays, dublinDateKey, dublinDayStart, dublinLocal, formatClock, formatShortDay, formatWhen, parseDateKey } from '../time';

export type ToolContext = { env: Env; token: string; now: Date };
export type ToolResult = Record<string, unknown>;

/** Bad arguments from the model: reported back to it so it can correct itself. */
class ToolInputError extends Error {}

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const MAX_RESULT_CHARS = 12_000;
const MAX_RANGE_DAYS = 31;

// ---- Declarations sent to Gemini (OpenAPI-style schema subset) ----

const dateParam = (what: string) => ({ type: 'string', description: `${what} date, YYYY-MM-DD (Europe/Dublin).` });

export const TOOL_DECLARATIONS = [
	{
		name: 'get_calendar',
		description:
			"Events from the user's Google Calendar between two dates (inclusive). Use for 'am I free', meetings, plans, what's on.",
		parameters: { type: 'object', properties: { start: dateParam('First'), end: dateParam('Last') }, required: ['start', 'end'] },
	},
	{
		name: 'get_blackboard',
		description:
			"The user's university timetable (lectures, labs, tutorials) and assignment deadlines from Blackboard between two dates (inclusive).",
		parameters: { type: 'object', properties: { start: dateParam('First'), end: dateParam('Last') }, required: ['start', 'end'] },
	},
	{
		name: 'get_emails',
		description:
			"Search the user's Gmail. Returns sender, subject, date, a short snippet and whether it's unread — never full bodies. Uses Gmail search syntax, e.g. 'is:unread in:inbox', 'alice newer_than:7d'. The user's mail is forwarded from their university account, so 'from:' matches the forwarding address, not the real sender: search a person or organisation by name or address as plain words instead (e.g. 'Murphy' not 'from:Murphy'). Results show the real sender. FT newsletters are excluded unless the query mentions FT.",
		parameters: {
			type: 'object',
			properties: {
				query: { type: 'string', description: 'Gmail search query.' },
				max: { type: 'integer', description: 'How many emails (1–20, default 10).' },
			},
			required: ['query'],
		},
	},
	{
		name: 'get_weather',
		description: 'Weather forecast for Dublin on one day (today up to 7 days ahead): conditions, high/low, rain chance, hourly detail.',
		parameters: { type: 'object', properties: { day: dateParam('The') }, required: ['day'] },
	},
	{
		name: 'get_ft_briefing',
		description:
			"AI briefing of the user's Financial Times newsletters received since yesterday morning: key stories plus a summary of each issue.",
		parameters: { type: 'object', properties: {} },
	},
];

// ---- Helpers ----

function dateArg(args: Record<string, unknown>, name: string): string {
	const v = args[name];
	if (typeof v !== 'string' || !parseDateKey(v)) throw new ToolInputError(`"${name}" must be a date like 2026-11-13.`);
	return v;
}

function dateRange(args: Record<string, unknown>): { start: string; end: string; from: Date; to: Date } {
	const start = dateArg(args, 'start');
	const end = typeof args.end === 'string' && args.end ? dateArg(args, 'end') : start;
	if (end < start) throw new ToolInputError('"end" must be on or after "start".');
	if (end > addDays(start, MAX_RANGE_DAYS - 1)) throw new ToolInputError(`Ask for at most ${MAX_RANGE_DAYS} days at a time.`);
	return { start, end, from: dublinDayStart(start), to: dublinDayStart(addDays(end, 1)) };
}

/** GET a Google API with the user's own token. Status codes only in errors. */
async function google<T>(url: string, ctx: ToolContext): Promise<T> {
	const res = await fetch(url, { headers: { Authorization: `Bearer ${ctx.token}` }, signal: AbortSignal.timeout(15_000) });
	if (!res.ok) throw new Error(`Google returned ${res.status}`);
	return (await res.json()) as T;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
	const out = new Array<R>(items.length);
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, async () => {
			while (next < items.length) {
				const i = next++;
				out[i] = await fn(items[i]);
			}
		}),
	);
	return out;
}

type MessageMeta = { id: string; snippet?: string; internalDate?: string; labelIds?: string[]; payload?: { headers?: Header[] } };

async function searchMessages(query: string, max: number, ctx: ToolContext): Promise<MessageMeta[]> {
	const list = await google<{ messages?: { id: string }[] }>(`${GMAIL}/messages?q=${encodeURIComponent(query)}&maxResults=${max}`, ctx);
	const fields = 'format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date';
	return mapLimit(list.messages ?? [], 5, (m) => google<MessageMeta>(`${GMAIL}/messages/${m.id}?${fields}`, ctx));
}

function receivedAt(m: MessageMeta): Date | null {
	const header = getHeader(m.payload?.headers, 'Date');
	const d = header ? new Date(header) : null;
	if (d && !Number.isNaN(d.getTime())) return d;
	return m.internalDate ? new Date(Number(m.internalDate)) : null;
}

function parseFrom(from: string): { name: string; address: string } {
	const m = from.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
	return m ? { name: m[1].trim() || m[2].trim(), address: m[2].trim() } : { name: from.trim(), address: from.trim() };
}

/**
 * Real sender, subject and snippet. Mail arrives forwarded from Outlook (Gmail's sender is the
 * tcd.ie forwarder), so the original sender is read from the forward block the snippet starts with.
 */
function senderOf(m: MessageMeta): { name: string; address: string; subject: string; snippet: string } {
	const from = parseFrom(getHeader(m.payload?.headers, 'From'));
	const snippet = decodeHtmlEntities(m.snippet ?? '');
	const real = resolveSender({ from: from.name, fromAddress: from.address, subject: getHeader(m.payload?.headers, 'Subject').trim() || '(no subject)' }, snippet);
	return {
		name: real.from,
		address: real.fromAddress,
		subject: real.subject,
		snippet: real.forwarded ? stripForwardedHeader(snippet, real.subject) : snippet,
	};
}

// ---- Tools ----

async function getCalendar(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
	const { start, end, from, to } = dateRange(args);
	type GEvent = {
		summary?: string;
		location?: string;
		transparency?: string;
		start?: { date?: string; dateTime?: string };
		end?: { date?: string; dateTime?: string };
		attendees?: { self?: boolean; responseStatus?: string }[];
	};
	const params = new URLSearchParams({
		timeMin: from.toISOString(),
		timeMax: to.toISOString(),
		singleEvents: 'true',
		orderBy: 'startTime',
		maxResults: '60',
		fields: 'items(summary,location,transparency,start,end,attendees(self,responseStatus))',
	});
	const data = await google<{ items?: GEvent[] }>(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, ctx);
	const events = (data.items ?? [])
		.filter((e) => !e.attendees?.some((a) => a.self && a.responseStatus === 'declined'))
		.map((e) => {
			const allDay = !!e.start?.date;
			const s = allDay ? dublinDayStart(e.start!.date!) : new Date(e.start?.dateTime ?? '');
			const f = allDay ? dublinDayStart(e.end?.date ?? addDays(e.start!.date!, 1)) : new Date(e.end?.dateTime ?? e.start?.dateTime ?? '');
			return {
				title: e.summary?.trim() || '(No title)',
				when: formatWhen(s, f, allDay),
				...(e.location ? { location: e.location } : {}),
				...(e.transparency === 'transparent' ? { showsAsFree: true } : {}),
			};
		});
	return { range: `${start} to ${end}`, events, count: events.length };
}

async function getBlackboard(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
	const { start, end, from, to } = dateRange(args);
	const r = await blackboardRange(ctx.env, from, to);
	return {
		range: `${start} to ${end}`,
		events: r.events.slice(0, 60).map((e) => ({
			title: e.title,
			when: formatWhen(new Date(e.start), new Date(e.end), e.allDay),
			...(e.location ? { location: e.location } : {}),
		})),
		deadlines: r.deadlines.slice(0, 40).map((d) => ({ title: d.title, due: `${formatShortDay(new Date(d.due))}, ${formatClock(new Date(d.due))}` })),
		...(r.feedHasLectureEvents ? {} : { note: 'This Blackboard feed contains deadlines only, no lecture times.' }),
	};
}

async function getEmails(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
	const query = typeof args.query === 'string' ? args.query.trim().slice(0, 200) : '';
	if (!query) throw new ToolInputError('"query" is required, e.g. "is:unread in:inbox".');
	const max = Math.min(20, Math.max(1, Math.round(Number(args.max) || 10)));
	const wantsFt = /\bft\b|ft\.com|financial times/i.test(query);
	// Forwarded FT mail can't be excluded by the search itself, so fetch extra and filter after.
	const messages = await searchMessages(wantsFt ? query : `${query} -from:ft.com`, wantsFt ? max : Math.min(20, max * 2), ctx);
	const emails = messages
		.map((m) => {
			const s = senderOf(m);
			const date = receivedAt(m);
			return {
				from: s.name === s.address ? s.address : `${s.name} <${s.address}>`,
				address: s.address,
				subject: s.subject,
				date: date ? `${formatShortDay(date)}, ${formatClock(date)}` : '',
				snippet: s.snippet.slice(0, 300),
				unread: m.labelIds?.includes('UNREAD') ?? false,
			};
		})
		.filter((e) => wantsFt || !isFtAddress(e.address))
		.slice(0, max)
		.map(({ address: _address, ...e }) => e);
	return { query, emails, count: emails.length };
}

async function getWeather(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
	const day = dateArg(args, 'day');
	const today = dublinDateKey(ctx.now);
	if (day < today || day > addDays(today, 7)) throw new ToolInputError('Weather is available from today up to 7 days ahead.');
	const url =
		'https://api.open-meteo.com/v1/forecast?latitude=53.3498&longitude=-6.2603' +
		'&hourly=temperature_2m,precipitation_probability,weather_code,is_day' +
		'&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset' +
		`&timezone=Europe%2FDublin&start_date=${day}&end_date=${day}`;
	const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
	if (!res.ok) throw new Error(`Open-Meteo returned ${res.status}`);
	type W = {
		daily?: Record<string, (number | string | null)[]>;
		hourly?: { time?: string[]; temperature_2m?: number[]; precipitation_probability?: (number | null)[]; weather_code?: number[]; is_day?: number[] };
	};
	const w = (await res.json()) as W;
	const d = w.daily ?? {};
	const h = w.hourly ?? {};
	const at = <T>(arr: T[] | undefined, i: number) => arr?.[i];
	return {
		day,
		condition: describeCode(Number(at(d.weather_code, 0)), true).label,
		highC: at(d.temperature_2m_max, 0),
		lowC: at(d.temperature_2m_min, 0),
		maxRainChancePercent: at(d.precipitation_probability_max, 0),
		sunrise: String(at(d.sunrise, 0) ?? '').slice(11, 16),
		sunset: String(at(d.sunset, 0) ?? '').slice(11, 16),
		hourly: (h.time ?? []).map((t, i) => ({
			time: t.slice(11, 16),
			tempC: at(h.temperature_2m, i),
			rainChancePercent: at(h.precipitation_probability, i),
			condition: describeCode(Number(at(h.weather_code, i)), at(h.is_day, i) !== 0).label,
		})),
	};
}

function briefingResult(d: CachedDigest): ToolResult {
	const byId = new Map(d.issues.map((i) => [i.id, i]));
	return {
		briefing: d.briefing,
		issues: d.summaries.map((s) => {
			const issue = byId.get(s.id);
			const received = issue ? new Date(issue.received) : null;
			return {
				newsletter: issue?.newsletter,
				subject: issue?.subject,
				received: received ? `${formatShortDay(received)}, ${formatClock(received)}` : '',
				summary: s.summary,
			};
		}),
	};
}

async function getFtBriefing(_args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
	// Today's digest is built at most once a day (by the app or here); reuse it without touching Gmail.
	const cached = await todaysDigest(ctx.env, ctx.now);
	if (cached) return briefingResult(cached);

	// Same selection as the app's FT cards: newsletter issues since 06:00 yesterday (Dublin).
	const [y, m, d] = dublinDateKey(ctx.now).split('-').map(Number);
	const since = dublinLocal(y, m, d - 1, 6);
	// Same search as the app: FT mail arrives forwarded, so match the text as well as the sender.
	const metas = await searchMessages('(from:ft.com OR "ft.com" OR "Financial Times") newer_than:3d', 60, ctx);
	const recent = metas
		.map((meta) => {
			const s = senderOf(meta);
			const kind = classifyFtEmail({ from: s.name, fromAddress: s.address, subject: s.subject });
			return { meta, subject: s.subject, received: receivedAt(meta), newsletter: kind.kind === 'newsletter' ? kind.name : null };
		})
		.filter((x) => x.newsletter && x.received && x.received >= since)
		.slice(0, 12);
	if (recent.length === 0) return { message: 'No FT newsletter issues since yesterday morning.' };

	const issues = await mapLimit(recent, 3, async (x) => {
		const msg = await google<{ payload?: MimePart }>(`${GMAIL}/messages/${x.meta.id}?format=full`, ctx);
		const body = await extractBody(msg.payload, async (attachmentId) =>
			(await google<{ data?: string }>(`${GMAIL}/messages/${x.meta.id}/attachments/${attachmentId}`, ctx)).data,
		);
		// Drop Outlook's forward block (the user's name and tcd address) before it goes to Gemini.
		const text = stripForwardedHeader(body.html ? htmlToPlainText(body.html) : tidy(body.text ?? ''), x.subject);
		return { id: x.meta.id, newsletter: x.newsletter!, subject: x.subject, received: x.received!.toISOString(), text: trimNewsletter(text || x.meta.snippet || '') };
	});
	const withText = issues.filter((i) => i.text);
	if (withText.length === 0) return { message: 'FT newsletters arrived, but they had no readable text.' };
	return briefingResult(await ftDigest(parseDigestInput({ issues: withText }), ctx.env, ctx.now));
}

const TOOLS: Record<string, (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>> = {
	get_calendar: getCalendar,
	get_blackboard: getBlackboard,
	get_emails: getEmails,
	get_weather: getWeather,
	get_ft_briefing: getFtBriefing,
};

export const TOOL_NAMES = Object.keys(TOOLS);

/** Run one tool call. Never throws: failures come back as { error } for Gemini to explain. */
export async function runTool(name: string, args: unknown, ctx: ToolContext): Promise<ToolResult> {
	const tool = TOOLS[name];
	if (!tool) return { error: `Unknown tool "${name}".` };
	try {
		const result = await tool((args && typeof args === 'object' ? args : {}) as Record<string, unknown>, ctx);
		const json = JSON.stringify(result);
		return json.length <= MAX_RESULT_CHARS ? result : { truncated: true, partialJson: json.slice(0, MAX_RESULT_CHARS) };
	} catch (err) {
		if (err instanceof ToolInputError) return { error: err.message };
		console.warn(`agent tool ${name} failed: ${err instanceof Error ? err.name : 'error'}`); // no details/content
		return { error: `Couldn't get that data right now (${err instanceof Error ? err.message : 'unknown error'}).` };
	}
}
