import { defineEndpoint } from "@waniwani/kit";

/**
 * Proof to OpenAI that this deployment is ours, served at
 * `/.well-known/openai-apps-challenge`.
 *
 * The token is issued per app *and* per origin, so preview and production do
 * not share one and it cannot be committed. Reading `process.env` at request
 * time rather than at import time is what lets one build answer correctly
 * wherever the platform runs it, and lets a rotated token take effect on a
 * redeploy with no code change.
 *
 * `text/plain`: the verifier compares the body byte for byte, and
 * `res.send(string)` would label it `text/html`.
 */
export default defineEndpoint({
	method: "get",
	handler: (_req, res) => {
		const token = process.env.OPENAI_APPS_CHALLENGE_TOKEN;
		if (!token) {
			// 404 rather than an empty 200: an unconfigured environment should look
			// unclaimed, not claimed by nobody.
			res.status(404).json({ error: "OPENAI_APPS_CHALLENGE_TOKEN is not set" });
			return;
		}
		res.type("text/plain").send(token);
	},
});
