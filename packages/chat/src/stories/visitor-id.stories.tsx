import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";
import type { VisitorIdInput } from "../@types";
import { ChatEmbed } from "../layouts/chat-embed";
import { getOrCreateVisitorId, setVisitorId } from "../lib/visitor-context";

// ============================================================================
// Visitor-id override stories — "see it working".
//
// The visitor id the widget sends is normally an anonymous, auto-generated
// value. These stories let you override it with an id you already track
// (PostHog / Amplitude / Segment) and watch the override actually reach the
// backend: a `fetch` shim records the `visitor.id` field off every POST /chat
// body and the control panel prints it, so "configured id" and "id the server
// received" line up.
//
// The override lands via the `visitorId` prop on `ChatEmbed` (shown here) and
// `WaniwaniChat`; the same value is available on the `<script>` embed via
// `data-visitor-id` and `WaniWani.chat.setVisitorId(id)`.
// ============================================================================

const MOCK_HOST = "visitorid.mock";
const MOCK_API = `https://${MOCK_HOST}/api/chat`;

const MOCK_REPLY =
	"Got it. Check the panel on the left: the visitor id my request carried " +
	"is the one you configured, not the auto-generated fallback.";

function sse(chunk: unknown): string {
	return `data: ${JSON.stringify(chunk)}\n\n`;
}

// --- Captured-send pub/sub ---------------------------------------------------
// The mock reads `visitor.id` out of each POST body and publishes it so the
// story panel can render what the server actually received.

let lastSentVisitorId: string | null = null;
const sentListeners = new Set<(id: string | null) => void>();

function publishSentVisitorId(id: string | null): void {
	lastSentVisitorId = id;
	for (const listener of sentListeners) {
		listener(id);
	}
}

function onVisitorIdSent(listener: (id: string | null) => void): () => void {
	sentListeners.add(listener);
	listener(lastSentVisitorId);
	return () => {
		sentListeners.delete(listener);
	};
}

function readVisitorIdFromBody(body: BodyInit | null | undefined): void {
	if (typeof body !== "string") {
		return;
	}
	try {
		const parsed = JSON.parse(body) as {
			visitor?: { id?: unknown };
		};
		const id = parsed.visitor?.id;
		if (typeof id === "string") {
			publishSentVisitorId(id);
		}
	} catch {
		// Not JSON we care about — ignore.
	}
}

function mockChatResponse(): Response {
	const encoder = new TextEncoder();
	const id = "t1";
	const words = MOCK_REPLY.split(" ");
	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			const send = (chunk: unknown) =>
				controller.enqueue(encoder.encode(sse(chunk)));
			send({ type: "start" });
			send({ type: "text-start", id });
			for (const word of words) {
				await new Promise<void>((resolve) => setTimeout(resolve, 25));
				send({ type: "text-delta", id, delta: `${word} ` });
			}
			send({ type: "text-end", id });
			send({ type: "finish" });
			controller.enqueue(encoder.encode("data: [DONE]\n\n"));
			controller.close();
		},
	});
	return new Response(stream, {
		headers: { "content-type": "text/event-stream" },
	});
}

function installMockBackend(): void {
	if (typeof window === "undefined") {
		return;
	}
	const w = window as typeof window & { __wwVisitorMock?: boolean };
	if (w.__wwVisitorMock) {
		return;
	}
	w.__wwVisitorMock = true;

	const realFetch = window.fetch;
	const mockFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
		const url =
			typeof input === "string"
				? input
				: input instanceof URL
					? input.href
					: input.url;
		if (!url.includes(MOCK_HOST)) {
			return realFetch(input, init);
		}
		const method = (init?.method ?? "GET").toUpperCase();
		if (method === "POST") {
			readVisitorIdFromBody(init?.body);
			return Promise.resolve(mockChatResponse());
		}
		return Promise.resolve(Response.json({ success: true }));
	}) as unknown as typeof window.fetch;
	const preconnect = (realFetch as { preconnect?: unknown }).preconnect;
	if (preconnect) {
		(mockFetch as { preconnect?: unknown }).preconnect = preconnect;
	}
	window.fetch = mockFetch;
}

installMockBackend();

// ----------------------------------------------------------------------------
// The demo: a control panel next to a live ChatEmbed.
// ----------------------------------------------------------------------------

interface DemoProps {
	/** Passed straight to `ChatEmbed` — the override under test. */
	visitorId?: VisitorIdInput;
	/** Show the runtime `setVisitorId()` control (the async-analytics path). */
	runtimeControl?: boolean;
	/** What to label the configured value as, for clarity in the panel. */
	configuredLabel: string;
}

function Row({ label, value }: { label: string; value: string }) {
	return (
		<div style={{ marginTop: 12 }}>
			<div style={{ fontSize: 11, textTransform: "uppercase", opacity: 0.6 }}>
				{label}
			</div>
			<code
				style={{
					display: "block",
					marginTop: 4,
					padding: "6px 8px",
					background: "#0f1115",
					color: "#7dd3fc",
					borderRadius: 6,
					fontSize: 13,
					wordBreak: "break-all",
				}}
			>
				{value}
			</code>
		</div>
	);
}

function VisitorIdDemo({
	visitorId,
	runtimeControl,
	configuredLabel,
}: DemoProps) {
	const [sent, setSent] = useState<string | null>(null);
	const [persisted, setPersisted] = useState<string>("");
	const [runtimeInput, setRuntimeInput] = useState("amplitude-device-9f2c");

	// Reflect what the server received.
	useEffect(() => onVisitorIdSent(setSent), []);

	// Poll the persisted id so the panel stays honest after a runtime override.
	useEffect(() => {
		const refresh = () => setPersisted(getOrCreateVisitorId());
		refresh();
		const timer = setInterval(refresh, 500);
		return () => clearInterval(timer);
	}, []);

	return (
		<div
			style={{
				display: "flex",
				height: "100dvh",
				fontFamily: "system-ui, sans-serif",
			}}
		>
			<aside
				style={{
					width: 320,
					padding: 20,
					background: "#f7f7f8",
					color: "#1f2937",
					borderRight: "1px solid #e5e7eb",
					overflowY: "auto",
				}}
			>
				<h2 style={{ fontSize: 16, fontWeight: 700 }}>Visitor id override</h2>
				<p
					style={{ fontSize: 13, lineHeight: 1.5, marginTop: 8, opacity: 0.8 }}
				>
					Send a message, then compare the two ids below. The id the request
					carried should match what you configured.
				</p>

				<Row label={configuredLabel} value={persisted || "(resolving…)"} />
				<Row
					label="Id the server received"
					value={sent ?? "(send a message)"}
				/>

				<div
					style={{
						marginTop: 12,
						fontSize: 12,
						fontWeight: 600,
						color: sent && sent === persisted ? "#15803d" : "#b45309",
					}}
				>
					{sent
						? sent === persisted
							? "✓ Override reached the backend"
							: "… differs — send a message to refresh"
						: "Waiting for the first message"}
				</div>

				{runtimeControl ? (
					<div style={{ marginTop: 20 }}>
						<div
							style={{
								fontSize: 11,
								textTransform: "uppercase",
								opacity: 0.6,
							}}
						>
							Runtime override
						</div>
						<p
							style={{
								fontSize: 12,
								lineHeight: 1.5,
								marginTop: 4,
								opacity: 0.8,
							}}
						>
							The async-analytics path: call <code>setVisitorId()</code> once
							your SDK is ready, then the next message carries it.
						</p>
						<input
							value={runtimeInput}
							onChange={(e) => setRuntimeInput(e.target.value)}
							style={{
								width: "100%",
								marginTop: 8,
								padding: "6px 8px",
								borderRadius: 6,
								border: "1px solid #d1d5db",
								fontSize: 13,
							}}
						/>
						<button
							type="button"
							onClick={() => setPersisted(setVisitorId(runtimeInput))}
							style={{
								marginTop: 8,
								padding: "6px 12px",
								borderRadius: 6,
								border: "none",
								background: "#2563eb",
								color: "white",
								fontSize: 13,
								fontWeight: 600,
								cursor: "pointer",
							}}
						>
							setVisitorId(…)
						</button>
					</div>
				) : null}
			</aside>

			<div style={{ flex: 1, minWidth: 0 }}>
				<ChatEmbed
					api={MOCK_API}
					skipRemoteConfig
					visitorId={visitorId}
					title="Visitor id demo"
					welcomeMessage="Ask me anything, then check the panel on the left."
					placeholder="Type a message…"
				/>
			</div>
		</div>
	);
}

const meta: Meta<typeof VisitorIdDemo> = {
	title: "Chat/Visitor ID",
	parameters: { bare: true },
};

export default meta;

type Story = StoryObj<typeof VisitorIdDemo>;

/**
 * A literal string. The commonest case: you already hold the id (a cookie,
 * a server-rendered value) when the widget mounts. Send a message and the
 * panel shows the same id reaching the backend.
 */
export const ConfiguredString: Story = {
	render: () => (
		<VisitorIdDemo
			visitorId="posthog-distinct-8a41c"
			configuredLabel="Id the widget sends"
		/>
	),
};

/**
 * A sync resolver — `() => posthog.get_distinct_id()`. Use when the id is
 * cheap to read at render time but you'd rather not thread it through props.
 */
export const SyncResolver: Story = {
	render: () => (
		<VisitorIdDemo
			visitorId={() => "segment-anon-4d7e"}
			configuredLabel="Id the widget sends"
		/>
	),
};

/**
 * An async resolver — `async () => (await sdk.ready()).id`. Use when the
 * analytics SDK only exposes its id after it bootstraps. The widget keeps the
 * auto id until the promise settles, then swaps to the resolved one.
 */
export const AsyncResolver: Story = {
	render: () => (
		<VisitorIdDemo
			visitorId={async () => {
				await new Promise<void>((resolve) => setTimeout(resolve, 600));
				return "amplitude-async-2b9f";
			}}
			configuredLabel="Id the widget sends"
		/>
	),
};

/**
 * Runtime override via `setVisitorId()`. Mirrors the `<script>` embed's
 * `WaniWani.chat.setVisitorId(id)`: no prop, you push the id imperatively once
 * your analytics SDK is ready. Set an id, then send a message to see it carry.
 */
export const RuntimeUpdate: Story = {
	render: () => (
		<VisitorIdDemo runtimeControl configuredLabel="Persisted visitor id" />
	),
};
