/**
 * An error whose message is safe to show the client (never contains secrets).
 * `code` lets the app show a short reason: ai_busy, ai_quota, ai_error, signin_expired, not_allowed.
 */
export class HttpError extends Error {
	constructor(
		readonly status: number,
		message: string,
		readonly code?: string,
	) {
		super(message);
	}
}

export function json(data: unknown, status: number, headers: HeadersInit = {}): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
	});
}
