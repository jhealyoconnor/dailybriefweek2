// Secrets: set with `npx wrangler secret put <NAME>` (production) or worker/.dev.vars (local).
// Declared here so they're typed; their values never appear in code or wrangler.jsonc.
interface Env {
	GEMINI_API_KEY: string;
	BLACKBOARD_ICS_URL: string;
	ALLOWED_EMAIL: string;
}
