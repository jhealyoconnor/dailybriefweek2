import { parseAgentInput, runAgent } from './agent/agent';
import { requireUser } from './auth';
import { loadCalendar } from './calendar';
import { ftDigest, parseDigestInput, todaysDigest } from './ftDigest';
import { HttpError, json } from './http';
import { parseTriageInput, triage } from './triage';

const MAX_TRIAGE_BODY = 64_000;
const MAX_DIGEST_BODY = 200_000;

function corsHeaders(request: Request, env: Env): Record<string, string> {
	const origin = request.headers.get('Origin');
	const allowed = env.ALLOWED_ORIGINS.split(',').map((o) => o.trim());
	if (!origin || !allowed.includes(origin)) return { Vary: 'Origin' };
	return {
		'Access-Control-Allow-Origin': origin,
		'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
		'Access-Control-Allow-Headers': 'Authorization, Content-Type',
		'Access-Control-Max-Age': '600',
		Vary: 'Origin',
	};
}

async function readJson(request: Request, maxBytes: number): Promise<unknown> {
	const body = await request.text();
	if (body.length > maxBytes) throw new HttpError(413, 'Request too large.');
	try {
		return JSON.parse(body);
	} catch {
		throw new HttpError(400, 'Body must be JSON.');
	}
}

const ROUTES: Record<string, string> = {
	'GET /calendar': 'calendar',
	'POST /triage': 'triage',
	'GET /ft-digest': 'ftDigestCached',
	'POST /ft-digest': 'ftDigest',
	'POST /agent': 'agent',
};

async function route(request: Request, env: Env): Promise<Response> {
	const { pathname } = new URL(request.url);
	const name = ROUTES[`${request.method} ${pathname}`];
	if (!name) throw new HttpError(404, 'Not found.');

	if (!env.GEMINI_API_KEY || !env.BLACKBOARD_ICS_URL || !env.ALLOWED_EMAIL) {
		throw new HttpError(500, 'The Worker is missing its secrets.');
	}
	await requireUser(request, env); // every route: Google token for the allowed account

	switch (name) {
		case 'calendar':
			return json(await loadCalendar(env), 200);
		case 'agent': {
			// The tools read Gmail/Calendar with the same token that requireUser just verified.
			const token = request.headers.get('Authorization')!.replace(/^Bearer\s+/i, '');
			const messages = parseAgentInput(await readJson(request, MAX_TRIAGE_BODY));
			return json(await runAgent(messages, { env, token, now: new Date() }), 200);
		}
		case 'ftDigestCached': {
			// Lets the app skip downloading newsletter bodies when today's digest already exists.
			const digest = await todaysDigest(env);
			return json(digest ? { ...digest, cached: true } : { cached: false }, 200);
		}
		case 'triage':
			return json(await triage(parseTriageInput(await readJson(request, MAX_TRIAGE_BODY)), env), 200);
		default:
			return json(await ftDigest(parseDigestInput(await readJson(request, MAX_DIGEST_BODY)), env), 200);
	}
}

export default {
	async fetch(request, env): Promise<Response> {
		const cors = corsHeaders(request, env);
		if (request.method === 'OPTIONS') {
			return new Response(null, { status: 'Access-Control-Allow-Origin' in cors ? 204 : 403, headers: cors });
		}
		try {
			const res = await route(request, env);
			for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
			return res;
		} catch (err) {
			if (err instanceof HttpError) return json({ error: err.message, ...(err.code ? { code: err.code } : {}) }, err.status, cors);
			console.error('Unhandled error:', err instanceof Error ? err.name : 'unknown');
			return json({ error: 'Something went wrong.' }, 500, cors);
		}
	},
} satisfies ExportedHandler<Env>;
