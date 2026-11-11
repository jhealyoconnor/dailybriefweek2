import { HttpError } from './http';

/*
 * Shared Gemini caller: structured JSON output, retries with backoff, then the
 * fallback model. Model pairs come from wrangler.jsonc (BULK_* and AGENT_*).
 * Logs carry status codes only — never the key or any email content.
 */

/** A model pair to use for one call. Plain strings so callers can pin a model. */
export type GeminiEnv = { GEMINI_API_KEY: string; GEMINI_MODEL: string; GEMINI_FALLBACK_MODEL: string };

/** "bulk" = /triage and /ft-digest (Flash-Lite, big free quota); "agent" = /agent (best available Flash). */
export function geminiFor(env: Env, use: 'bulk' | 'agent'): GeminiEnv {
	return use === 'bulk'
		? { GEMINI_API_KEY: env.GEMINI_API_KEY, GEMINI_MODEL: env.BULK_MODEL, GEMINI_FALLBACK_MODEL: env.BULK_FALLBACK_MODEL }
		: { GEMINI_API_KEY: env.GEMINI_API_KEY, GEMINI_MODEL: env.AGENT_MODEL, GEMINI_FALLBACK_MODEL: env.AGENT_FALLBACK_MODEL };
}

// Models whose daily quota is used up, until roughly when it resets. Per Worker instance: it just
// saves a pointless round trip; a model is never skipped for longer than Gemini said to wait.
const exhaustedUntil = new Map<string, number>();
export const resetQuotaMemory = () => exhaustedUntil.clear();

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
export function modelsToTry(env: Pick<GeminiEnv, 'GEMINI_MODEL' | 'GEMINI_FALLBACK_MODEL'>): string[] {
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
	let quotaExhausted = 0; // models whose daily quota is used up

	for (const [index, model] of models.entries()) {
		if ((exhaustedUntil.get(model) ?? 0) > deps.now()) {
			quotaExhausted++; // known to be out of quota today: don't even ask
			continue;
		}
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
			const quotaWaitMs = res.status === 429 ? dailyQuotaWaitMs(await res.text().catch(() => '')) : null;
			const daily = quotaWaitMs !== null;
			if (res.status !== 429) await res.body?.cancel();
			console.warn(`Gemini ${model} attempt ${attempt + 1}: HTTP ${res.status}${daily ? ' (daily quota used up)' : ''}`);
			if (daily) {
				// Retrying can't help until the quota resets (midnight Pacific): try the fallback now.
				exhaustedUntil.set(model, deps.now() + quotaWaitMs);
				quotaExhausted++;
				break;
			}
			if (res.status === 404) break; // model ID not found/retired: go straight to the fallback
			if (!RETRYABLE.has(res.status)) {
				// 400/401/403 etc. won't fix themselves (bad request or key problem).
				throw new HttpError(502, 'Gemini rejected the request.', 'ai_error');
			}
		}
	}
	if (quotaExhausted === models.length) {
		throw new HttpError(429, 'Daily AI limit reached, resets at about 8am.', 'ai_quota');
	}
	throw new HttpError(503, 'Gemini is busy right now. Try again in a minute.', 'ai_busy');
}

/**
 * A 429 is either a short-term rate limit (worth retrying) or a used-up daily quota (not).
 * Gemini says which in the error details: a per-day quota id, or a retry delay of minutes/hours.
 * Returns how long to wait for a daily quota, or null for a short-term limit. Only these
 * structured fields are read; nothing from the body is logged.
 */
export function dailyQuotaWaitMs(body: string): number | null {
	try {
		const details = (JSON.parse(body) as { error?: { details?: Record<string, unknown>[] } }).error?.details ?? [];
		const perDay = details.some((d) =>
			((d.violations as { quotaId?: string }[] | undefined) ?? []).some((v) => /PerDay/i.test(v.quotaId ?? '')),
		);
		const delayText = details.find((d) => typeof d.retryDelay === 'string')?.retryDelay as string | undefined;
		const delayMs = delayText ? parseFloat(delayText) * 1000 : NaN;
		if (!perDay && !(delayMs > 120_000)) return null;
		return delayMs > 0 ? Math.min(delayMs, 24 * 3600_000) : 3600_000; // unknown: check again in an hour
	} catch {
		return null;
	}
}

export const isDailyQuota = (body: string) => dailyQuotaWaitMs(body) !== null;

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
