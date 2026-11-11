export const TIME_ZONE = 'Europe/Dublin';

const dateKeyFormat = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const offsetFormat = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, timeZoneName: 'longOffset' });

/** 'YYYY-MM-DD' for an instant, in Dublin. */
export function dublinDateKey(date: Date): string {
	return dateKeyFormat.format(date);
}

/** Dublin's UTC offset in minutes at the given instant (0 in winter, 60 in summer). */
function offsetMinutes(at: Date): number {
	const name = offsetFormat.formatToParts(at).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
	const m = name.match(/GMT([+-])(\d{2}):(\d{2})/);
	return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
}

/** The instant when Dublin's wall clock shows the given local date/time. */
export function dublinLocal(y: number, mo: number, d: number, h = 0, mi = 0, s = 0): Date {
	const asUtc = Date.UTC(y, mo - 1, d, h, mi, s);
	let result = asUtc - offsetMinutes(new Date(asUtc)) * 60_000;
	result = asUtc - offsetMinutes(new Date(result)) * 60_000; // settle across a DST change
	return new Date(result);
}

/** Start of today and start of tomorrow in Dublin. */
export function dublinToday(now = new Date()): { start: Date; end: Date } {
	const [y, m, d] = dublinDateKey(now).split('-').map(Number);
	return { start: dublinLocal(y, m, d), end: dublinLocal(y, m, d + 1) };
}

// ---- Formatting for the assistant (prompt date table and tool results) ----

const longDate = new Intl.DateTimeFormat('en-IE', { timeZone: TIME_ZONE, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const shortDay = new Intl.DateTimeFormat('en-IE', { timeZone: TIME_ZONE, weekday: 'short', day: 'numeric', month: 'short' });
const clock = new Intl.DateTimeFormat('en-IE', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** "Wednesday 11 November 2026" */
export const formatLongDate = (d: Date) => longDate.format(d);
/** "Thu 13 Nov" */
export const formatShortDay = (d: Date) => shortDay.format(d);
/** "14:05" (Dublin) */
export const formatClock = (d: Date) => clock.format(d);

/** 'YYYY-MM-DD' → [year, month, day]; null if it isn't a real calendar date. */
export function parseDateKey(key: string): [number, number, number] | null {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
	const [y, m, d] = key.split('-').map(Number);
	const check = new Date(Date.UTC(y, m - 1, d));
	return check.getUTCFullYear() === y && check.getUTCMonth() === m - 1 && check.getUTCDate() === d ? [y, m, d] : null;
}

/** Shift a 'YYYY-MM-DD' key by whole days. */
export function addDays(key: string, days: number): string {
	const [y, m, d] = key.split('-').map(Number);
	return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Dublin midnight at the start of a 'YYYY-MM-DD' day. */
export function dublinDayStart(key: string): Date {
	const [y, m, d] = key.split('-').map(Number);
	return dublinLocal(y, m, d);
}

/** Readable Dublin time range: "Thu 13 Nov, 10:00–11:00", "Thu 13 Nov (all day)". */
export function formatWhen(start: Date, end: Date, allDay: boolean): string {
	if (allDay) {
		const lastDay = new Date(end.getTime() - 1);
		return dublinDateKey(start) === dublinDateKey(lastDay)
			? `${formatShortDay(start)} (all day)`
			: `${formatShortDay(start)} – ${formatShortDay(lastDay)} (all day)`;
	}
	const sameDay = dublinDateKey(start) === dublinDateKey(end);
	return sameDay
		? `${formatShortDay(start)}, ${formatClock(start)}–${formatClock(end)}`
		: `${formatShortDay(start)} ${formatClock(start)} – ${formatShortDay(end)} ${formatClock(end)}`;
}
