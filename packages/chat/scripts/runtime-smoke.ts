/**
 * Opens a real chat session against a deployed platform and agent runtime with
 * the eve client this package bundles, and fails when the two cannot talk.
 * Run it before releasing the chat and before upgrading eve on the runtime:
 * a runtime that serves a message stream version the bundled client does not
 * know makes every chat fall back to the chat route without any visible error.
 *
 *   WANIWANI_SMOKE_TOKEN=wwp_... WANIWANI_SMOKE_CHANNEL=<channel id> \
 *   WANIWANI_SMOKE_ORIGIN=https://a-site-the-channel-allows \
 *   bun run --cwd packages/chat smoke:runtime
 *
 * WANIWANI_SMOKE_SESSION_API defaults to the US platform. Set
 * WANIWANI_SMOKE_MESSAGE to also send one turn and wait for its answer, which
 * costs model tokens. Sessions are opened with `?test=1`, so they stay out of
 * the channel's analytics.
 */
import type { UIMessageChunk } from "ai";
import { EveSession, type OpenSession } from "../src/lib/eve/session";
import { sessionRoute } from "../src/lib/eve/transport";

const DEFAULT_SESSION_API = "https://app.waniwani.ai/api/mcp/agent/session";

function required(name: string): string {
	const value = process.env[name];
	if (!value) {
		console.error(`Missing ${name}.`);
		process.exit(2);
	}
	return value;
}

function fail(reason: string): never {
	console.error(`FAIL  ${reason}`);
	process.exit(1);
}

const token = required("WANIWANI_SMOKE_TOKEN");
const channelId = required("WANIWANI_SMOKE_CHANNEL");
const origin = required("WANIWANI_SMOKE_ORIGIN");
const message = process.env.WANIWANI_SMOKE_MESSAGE;
const sessionApi = new URL(
	process.env.WANIWANI_SMOKE_SESSION_API ?? DEFAULT_SESSION_API,
);
sessionApi.searchParams.set("test", "1");

Object.defineProperty(globalThis, "location", {
	value: new URL(origin),
	configurable: true,
});

const route = sessionRoute({
	sessionApi: sessionApi.href,
	headers: () => ({ Authorization: `Bearer ${token}`, Origin: origin }),
});

const latest: { grant: Awaited<ReturnType<OpenSession>> } = { grant: null };
const open: OpenSession = async (request) => {
	latest.grant = await route(request);
	return latest.grant;
};

async function servedStreamVersion(): Promise<string> {
	const granted = latest.grant;
	if (!granted) {
		return "unknown";
	}
	const response = await fetch(
		new URL(
			`/eve/v1/session/${granted.sessionId}/stream?includeTailIndex=1`,
			granted.eveHost,
		),
		{ headers: { authorization: `Bearer ${granted.accessToken}` } },
	);
	await response.body?.cancel();
	return response.headers.get("x-eve-stream-version") ?? "none";
}

async function answerTo(session: EveSession, text: string): Promise<string> {
	const chunks: UIMessageChunk[] = [];
	const reader = session.turn(text, {}).getReader();
	for (;;) {
		const { done, value } = await reader.read();
		if (done) {
			break;
		}
		chunks.push(value);
	}
	const failure = chunks.find((chunk) => chunk.type === "error");
	if (failure?.type === "error") {
		fail(`the turn failed: ${failure.errorText}`);
	}
	return chunks
		.flatMap((chunk) => (chunk.type === "text-delta" ? [chunk.delta] : []))
		.join("");
}

const session = await EveSession.create({ open, channelId });
const granted = latest.grant;

if (!granted) {
	fail(
		"the platform keeps this channel on the chat route (transport app-chat), so there is no runtime session to check",
	);
}
if (!session) {
	fail(
		`the bundled eve client cannot hold a session with ${granted.eveHost}, which serves message stream version ${await servedStreamVersion()}. Upgrade eve in packages/chat to the version the runtime runs.`,
	);
}
console.log(
	`ok    session open on ${granted.eveHost}, message stream version ${await servedStreamVersion()}`,
);

if (message) {
	const answer = await answerTo(session, message);
	if (!answer.trim()) {
		fail("the turn completed without any answer text");
	}
	console.log(`ok    turn answered (${answer.length} characters)`);
}

session.close();
process.exit(0);
