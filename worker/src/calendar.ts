import ICAL from 'ical.js';
import { HttpError } from './http';
import { dublinLocal, dublinToday } from './time';

export type ScheduleItem = { id: string; title: string; start: string; end: string; allDay: boolean; location: string };
export type Deadline = { id: string; title: string; due: string };
export type CalendarResult = {
	today: ScheduleItem[];
	deadlines: Deadline[];
	/** False when the feed has no lecture/class-type events at all (only deadlines). */
	hasLectureEvents: boolean;
};

const DEADLINE_WORDS = /\b(due|deadline|submissions?|submit|hand[- ]?in)\b/i;
const MAX_FEED_BYTES = 5_000_000;
const DAY_MS = 86_400_000;

type Occurrence = { uid: string; title: string; location: string; start: Date; end: Date; allDay: boolean; deadline: boolean };

/** ical.js time → instant. Dates and floating times are read as Dublin wall-clock time. */
function toDate(t: ICAL.Time): Date {
	if (t.isDate) return dublinLocal(t.year, t.month, t.day);
	const zone = t.zone;
	const floating = !zone || zone === ICAL.Timezone.localTimezone;
	return floating ? dublinLocal(t.year, t.month, t.day, t.hour, t.minute, t.second) : t.toJSDate();
}

function isDeadline(title: string, description: string, start: Date, end: Date): boolean {
	return end.getTime() === start.getTime() || DEADLINE_WORDS.test(title) || DEADLINE_WORDS.test(description);
}

function occurrence(event: ICAL.Event, start: ICAL.Time, end: ICAL.Time | null): Occurrence {
	const s = toDate(start);
	const e = end ? toDate(end) : start.isDate ? new Date(s.getTime() + DAY_MS) : s;
	const title = (event.summary ?? '').trim() || '(Untitled)';
	return {
		uid: event.uid ?? '',
		title,
		location: (event.location ?? '').trim(),
		start: s,
		end: e,
		allDay: start.isDate,
		deadline: isDeadline(title, event.description ?? '', s, e),
	};
}

/** Every occurrence (recurring events expanded, EXDATEs and overrides applied) that touches [from, to). */
function occurrences(text: string, from: Date, to: Date): { list: Occurrence[]; hasLectureEvents: boolean } {
	const root = new ICAL.Component(ICAL.parse(text));
	for (const tz of root.getAllSubcomponents('vtimezone')) ICAL.TimezoneService.register(tz);

	const vevents = root.getAllSubcomponents('vevent');
	// Group overrides (RECURRENCE-ID) by UID ourselves: left to itself, ical.js attaches every
	// override in the calendar to every recurring series, whatever its UID.
	const overrides = new Map<string, ICAL.Component[]>();
	for (const v of vevents) {
		if (!v.hasProperty('recurrence-id')) continue;
		const uid = String(v.getFirstPropertyValue('uid') ?? '');
		overrides.set(uid, [...(overrides.get(uid) ?? []), v]);
	}

	const masters = new Map<string, ICAL.Event>();
	const singles: ICAL.Event[] = [];
	for (const vevent of vevents) {
		if (vevent.hasProperty('recurrence-id')) continue;
		const uid = String(vevent.getFirstPropertyValue('uid') ?? '');
		const event = new ICAL.Event(vevent, { strictExceptions: true, exceptions: overrides.get(uid) ?? [] });
		if (event.isRecurring() && uid) masters.set(uid, event);
		else singles.push(event);
	}
	// Overrides with no matching series: show them as one-offs.
	for (const [uid, list] of overrides) {
		if (!masters.has(uid)) singles.push(...list.map((v) => new ICAL.Event(v)));
	}

	const list: Occurrence[] = [];
	let hasLectureEvents = false;
	const touches = (o: Occurrence) => o.start < to && (o.end > from || o.start >= from);

	for (const event of singles) {
		const o = occurrence(event, event.startDate, event.endDate);
		if (!o.deadline) hasLectureEvents = true;
		if (touches(o)) list.push(o);
	}
	for (const event of masters.values()) {
		const iterator = event.iterator();
		let first = true;
		for (let next = iterator.next(), guard = 0; next && guard < 5000; next = iterator.next(), guard++) {
			const details = event.getOccurrenceDetails(next);
			const o = occurrence(details.item, details.startDate, details.endDate);
			if (first && !o.deadline) hasLectureEvents = true;
			first = false;
			if (o.start >= to) break;
			if (touches(o)) list.push(o);
		}
	}
	return { list, hasLectureEvents };
}

export async function loadCalendar(env: Env, now = new Date()): Promise<CalendarResult> {
	const res = await fetch(env.BLACKBOARD_ICS_URL, {
		signal: AbortSignal.timeout(15_000),
		cf: { cacheTtl: 900, cacheEverything: true }, // Cloudflare edge cache: 15 minutes
	});
	if (!res.ok) {
		console.error('Blackboard feed request failed', res.status); // never log the URL
		throw new HttpError(502, 'Couldn’t fetch the Blackboard calendar.');
	}
	const text = await res.text();
	if (text.length > MAX_FEED_BYTES || !text.includes('BEGIN:VCALENDAR')) {
		throw new HttpError(502, 'The Blackboard calendar feed wasn’t a valid calendar.');
	}

	const { start: todayStart, end: todayEnd } = dublinToday(now);
	const weekEnd = new Date(now.getTime() + 7 * DAY_MS);
	let parsed: ReturnType<typeof occurrences>;
	try {
		parsed = occurrences(text, todayStart, new Date(Math.max(weekEnd.getTime(), todayEnd.getTime())));
	} catch (err) {
		console.error('Calendar parse failed:', err instanceof Error ? err.name : 'unknown');
		throw new HttpError(502, 'Couldn’t read the Blackboard calendar.');
	}

	const id = (o: Occurrence) => `${o.uid}@${o.start.toISOString()}`;
	const today = parsed.list
		.filter((o) => !o.deadline && o.start < todayEnd && (o.end > todayStart || o.start >= todayStart))
		.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.getTime() - b.start.getTime())
		.map((o) => ({ id: id(o), title: o.title, start: o.start.toISOString(), end: o.end.toISOString(), allDay: o.allDay, location: o.location }));

	// A deadline's due time is its end (equal to its start for zero-length due markers).
	const deadlines = parsed.list
		.filter((o) => o.deadline && o.end >= now && o.end <= weekEnd)
		.sort((a, b) => a.end.getTime() - b.end.getTime())
		.map((o) => ({ id: id(o), title: o.title, due: o.end.toISOString() }));

	return { today, deadlines, hasLectureEvents: parsed.hasLectureEvents };
}
