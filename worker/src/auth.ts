import { HttpError } from './http';

/*
 * Every request must carry the Google access token the app got at sign-in.
 * We ask Google who that token belongs to (tokeninfo) and only continue if it was
 * issued to this app's OAuth client, for the one allowed, verified email address.
 */

type TokenInfo = {
	aud?: string;
	azp?: string;
	email?: string;
	email_verified?: string | boolean;
	expires_in?: string | number;
};

// Short-lived, per-isolate cache so a page load (several requests) checks the token once.
// Keyed by a SHA-256 hash so the raw token isn't kept as a map key.
const verified = new Map<string, { email: string; until: number }>();
const CACHE_MS = 5 * 60_000;

async function sha256(text: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function requireUser(request: Request, env: Env): Promise<string> {
	const match = request.headers.get('Authorization')?.match(/^Bearer\s+([\w.\-~+/]+=*)$/i);
	if (!match) throw new HttpError(401, 'Missing Google access token.', 'signin_expired');
	const token = match[1];

	const key = await sha256(token);
	const hit = verified.get(key);
	if (hit && hit.until > Date.now()) return hit.email;
	verified.delete(key);

	// POST keeps the token out of the URL (and so out of any URL logging).
	const res = await fetch('https://oauth2.googleapis.com/tokeninfo', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({ access_token: token }),
	});
	if (!res.ok) throw new HttpError(401, 'Google token is invalid or expired.', 'signin_expired');
	const info = (await res.json()) as TokenInfo;

	const expiresIn = Number(info.expires_in);
	const email = (info.email ?? '').trim().toLowerCase();
	const ok =
		info.aud === env.GOOGLE_CLIENT_ID &&
		expiresIn > 0 &&
		(info.email_verified === true || info.email_verified === 'true') &&
		email !== '' &&
		email === env.ALLOWED_EMAIL.trim().toLowerCase();
	if (!ok) throw new HttpError(401, 'This Google account is not allowed.', 'not_allowed');

	if (verified.size > 100) verified.clear();
	verified.set(key, { email, until: Date.now() + Math.min(CACHE_MS, expiresIn * 1000) });
	return email;
}
