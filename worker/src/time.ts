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
