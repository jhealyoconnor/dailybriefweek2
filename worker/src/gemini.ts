import { HttpError } from './http';

/*
 * Shared Gemini caller: structured JSON output, retries with backoff, then the
 * fallback model. Models come from GEMINI_MODEL / GEMINI_FALLBACK_MODEL in wrangler.jsonc.
 * Logs carry status codes only — never the key or any email content.
 */

type GeminiEnv = Pick<Env, 'GEMINI_API_KEY' | 'GEMINI_MODEL' | 'GEMINI_FALLBACK_MODEL'>;

export type GeminiResponse = {
	candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
};

/** Waits before retries 1, 2 and 3 (so up to 4 attempts per model). */
export const RETRY_DELAYS_MS = [1000, 2000, 4000];
/** Temporary problems worth retrying: rate limit, server errors, overloaded/unavailable. */
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export type Timing = {
	/** A hung request counts as a failed attempt after this long. */
	attemptTimeoutMs: number;
	/** Time allowed for the primary model before moving to the fallback. */
	primaryBudgetMs: number;
	/** Overall limit — the app is waiting on this request. */
	totalBudgetMs: number;
};
export const DEFAULT_TIMING: Timing = { attemptTimeoutMs: 10_000, primaryBudgetMs: 30_000, totalBudgetMs: 55_000 };

export type GenerateDeps = { fetch: typeof fetch; sleep: (ms: number) => Promise<void>; now: () => number };
const realDeps: GenerateDeps = {
	fetch: (...args) => fetch(...args),
	sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
	now: () => Date.now(),
};

/** Primary model, then the fallback (if set and different). */
export function modelsToTry(env: Pick<Env, 'GEMINI_MODEL' | 'GEMINI_FALLBACK_MODEL'>): string[] {
	const models = [env.GEMINI_MODEL, env.GEMINI_FALLBACK_MODEL].map((m) => (m ?? '').trim()).filter(Boolean);
	return [...new Set(models)];
}

export async function generateWithRetry(
	requestBody: string,
	env: GeminiEnv,
	deps: GenerateDeps = realDeps,
	timing: Timing = DEFAULT_TIMING,
): Promise<{ data: GeminiResponse; model: string }> {
	const started = deps.now();
	const models = modelsToTry(env);

	for (const [index, model] of models.entries()) {
		const isLast = index === models.length - 1;
		const modelDeadline = started + (isLast ? timing.totalBudgetMs : Math.min(timing.primaryBudgetMs, timing.totalBudgetMs));

		for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
			if (attempt > 0) {
				const wait = RETRY_DELAYS_MS[attempt - 1];
				if (deps.now() + wait + 1000 > modelDeadline) break; // no time left for this model
				await deps.sleep(wait);
			}
			const timeout = Math.min(timing.attemptTimeoutMs, modelDeadline - deps.now());
			if (timeout < 1000) break;

			let res: Response;
			try {
				res = await deps.fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
					signal: AbortSignal.timeout(timeout),
					body: requestBody,
				});
			} catch (err) {
				console.warn(`Gemini ${model} attempt ${attempt + 1}: ${err instanceof Error ? err.name : 'network error'}`);
				continue; // timeout or network error: retry
			}
			if (res.ok) {
				if (index > 0) console.warn(`Gemini: used fallback model ${model}`);
				return { data: (await res.json()) as GeminiResponse, model };
			}
			console.warn(`Gemini ${model} attempt ${attempt + 1}: HTTP ${res.status}`);
			await res.body?.cancel();
			if (res.status === 404) break; // model ID not found/retired: go straight to the fallback
			if (!RETRYABLE.has(res.status)) {
				// 400/401/403 etc. won't fix themselves (bad request or key problem).
				throw new HttpError(502, 'Gemini rejected the request.');
			}
		}
	}
	throw new HttpError(503, 'Gemini is busy right now. Try again in a minute.');
}

/** Ask Gemini for JSON matching `schema`; returns the parsed (not yet validated) value. */
export async function generateJson(
	prompt: { system: string; user: string; schema: object },
	env: GeminiEnv,
	timing: Timing = DEFAULT_TIMING,
): Promise<{ value: unknown; model: string }> {
	const requestBody = JSON.stringify({
		systemInstruction: { parts: [{ text: prompt.system }] },
		contents: [{ role: 'user', parts: [{ text: prompt.user }] }],
		generationConfig: {
			temperature: 0,
			responseFormat: { text: { mimeType: 'APPLICATION_JSON', schema: prompt.schema } },
		},
	});
	const { data, model } = await generateWithRetry(requestBody, env, realDeps, timing);
	const output = (data.candidates?.[0]?.content?.parts ?? [])
		.filter((p) => !p.thought && typeof p.text === 'string')
		.map((p) => p.text)
		.join('');
	try {
		return { value: JSON.parse(output), model };
	} catch {
		console.error('Gemini output was not JSON', data.candidates?.[0]?.finishReason ?? '');
		throw new HttpError(502, 'Gemini returned an unexpected result.');
	}
}
