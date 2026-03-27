"use client";

import {
	parseJsonEventStream,
	readUIMessageStream,
	type UIMessage,
	uiMessageChunkSchema,
} from "ai";
import { useEffect, useRef, useState } from "react";

// ---- Types ----

type SessionPart = { type: string; [key: string]: unknown };
type SessionMessage = {
	id: string;
	role: "user" | "assistant" | "system" | "data";
	parts: SessionPart[];
};
type Session = {
	name: string;
	mode?: "regenerate" | "inject";
	outcome?: { toolsCalled: string[] };
	messages: SessionMessage[];
};
type TurnResult = {
	input: string;
	toolsCalled: string[];
	expectedTools: string[];
	output: string;
};
type RunResult = {
	turns: TurnResult[];
	score: number;
};

// ---- Replay helpers ----

function getRecordedTools(msg: SessionMessage): string[] {
	return msg.parts
		.filter((p) => p.type === "dynamic-tool" || p.type.startsWith("tool-"))
		.map((p) => p.toolName as string)
		.filter(Boolean);
}

function getUserText(msg: SessionMessage): string {
	return msg.parts
		.filter(
			(p): p is { type: "text"; text: string } =>
				p.type === "text" && typeof (p as { text?: unknown }).text === "string",
		)
		.map((p) => p.text)
		.join("");
}

async function sendTurn(
	messages: UIMessage[],
	apiUrl: string,
): Promise<{ toolsCalled: string[]; output: string; message: UIMessage }> {
	const response = await fetch(apiUrl, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		signal: AbortSignal.timeout(60_000),
		body: JSON.stringify({ messages }),
	});

	if (!response.ok || !response.body) {
		throw new Error(`Chat returned ${response.status}`);
	}

	const chunkStream = parseJsonEventStream({
		stream: response.body,
		schema: uiMessageChunkSchema,
	}).pipeThrough(
		new TransformStream({
			transform(chunk, controller) {
				if (chunk.success) {
					controller.enqueue(chunk.value);
				}
			},
		}),
	);

	let finalMessage: UIMessage | undefined;
	for await (const msg of readUIMessageStream({ stream: chunkStream })) {
		finalMessage = msg;
	}
	if (!finalMessage) {
		throw new Error("No message received");
	}

	const toolsCalled = finalMessage.parts
		.filter((p) => p.type === "dynamic-tool" || p.type.startsWith("tool-"))
		.map((p) => (p as unknown as { toolName: string }).toolName)
		.filter(Boolean);

	const output = finalMessage.parts
		.filter((p): p is { type: "text"; text: string } => p.type === "text")
		.map((p) => p.text)
		.join("");

	return { toolsCalled, output, message: finalMessage };
}

// ---- Sub-components ----

function Dot({ pass }: { pass: boolean | null }) {
	const color =
		pass === null
			? "ww:bg-gray-300 dark:ww:bg-gray-600"
			: pass
				? "ww:bg-green-500"
				: "ww:bg-red-500";
	return (
		<span
			className={`ww:inline-block ww:w-2 ww:h-2 ww:rounded-full ww:shrink-0 ${color}`}
		/>
	);
}

function TurnRow({ turn }: { turn: TurnResult }) {
	const [open, setOpen] = useState(false);
	const allPass =
		turn.expectedTools.length === 0 ||
		turn.expectedTools.every((t) => turn.toolsCalled.includes(t));

	return (
		<div className="ww:border ww:border-border ww:rounded-lg ww:overflow-hidden">
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				className="ww:w-full ww:flex ww:items-center ww:gap-2 ww:px-3 ww:py-2 ww:text-left ww:hover:bg-muted/50 ww:transition-colors"
			>
				<Dot pass={turn.expectedTools.length > 0 ? allPass : null} />
				<span className="ww:text-xs ww:text-foreground ww:truncate ww:flex-1">
					{turn.input}
				</span>
				{turn.toolsCalled.length > 0 && (
					<span className="ww:text-xs ww:text-muted-foreground ww:shrink-0">
						{turn.toolsCalled.join(", ")}
					</span>
				)}
				<span className="ww:text-xs ww:text-muted-foreground">
					{open ? "▲" : "▼"}
				</span>
			</button>
			{open && (
				<div className="ww:px-3 ww:pb-3 ww:pt-2 ww:border-t ww:border-border ww:space-y-1.5">
					{turn.expectedTools.map((tool) => {
						const hit = turn.toolsCalled.includes(tool);
						return (
							<div
								key={tool}
								className="ww:flex ww:items-center ww:gap-2 ww:text-xs"
							>
								<Dot pass={hit} />
								<span className="ww:font-mono ww:text-foreground">{tool}</span>
								{!hit && turn.toolsCalled.length > 0 && (
									<span className="ww:text-muted-foreground">
										got [{turn.toolsCalled.join(", ")}]
									</span>
								)}
							</div>
						);
					})}
					{turn.output && (
						<p className="ww:text-xs ww:text-muted-foreground ww:italic ww:border-t ww:border-border ww:pt-2 ww:line-clamp-2">
							{turn.output}
						</p>
					)}
				</div>
			)}
		</div>
	);
}

// ---- Main component ----

export function EvalPanel({ api, hidden }: { api: string; hidden?: boolean }) {
	const [sessions, setSessions] = useState<Session[]>([]);
	const [selected, setSelected] = useState<Session | null>(null);
	const [running, setRunning] = useState(false);
	const [result, setResult] = useState<RunResult | null>(null);
	const [error, setError] = useState<string | null>(null);
	const abortRef = useRef<AbortController | null>(null);

	useEffect(() => {
		fetch(`${api}/sessions`)
			.then((r) => r.json())
			.then((data: Session[]) => {
				setSessions(data);
			})
			.catch(() => {});
	}, [api]);

	async function runSession(session: Session) {
		abortRef.current?.abort();
		abortRef.current = new AbortController();
		setRunning(true);
		setResult(null);
		setError(null);

		try {
			const history: UIMessage[] = [];
			const turns: TurnResult[] = [];

			const userTurns: { user: SessionMessage; assistant?: SessionMessage }[] =
				[];
			for (let i = 0; i < session.messages.length; i++) {
				const msg = session.messages[i];
				if (msg.role === "user") {
					const next = session.messages[i + 1];
					userTurns.push({
						user: msg,
						assistant: next?.role === "assistant" ? next : undefined,
					});
				}
			}

			for (const { user, assistant } of userTurns) {
				const userMsg: UIMessage = {
					...(user as unknown as UIMessage),
				};
				history.push(userMsg);

				const expectedTools = assistant ? getRecordedTools(assistant) : [];
				const { toolsCalled, output, message } = await sendTurn(history, api);
				history.push(message);

				turns.push({
					input: getUserText(user),
					toolsCalled,
					expectedTools,
					output,
				});
			}

			const allAssertions = turns.flatMap((t) =>
				t.expectedTools.map((tool) => t.toolsCalled.includes(tool)),
			);
			const score =
				allAssertions.length > 0
					? allAssertions.filter(Boolean).length / allAssertions.length
					: 1;

			setResult({ turns, score });
		} catch (e) {
			if ((e as Error).name !== "AbortError") {
				setError(String(e));
			}
		} finally {
			setRunning(false);
		}
	}

	return (
		<div
			className="ww:flex ww:flex-col ww:h-full ww:overflow-hidden"
			style={hidden ? { display: "none" } : undefined}
		>
			{/* Session list */}
			<div className="ww:flex-1 ww:overflow-y-auto ww:min-h-0">
				{sessions.length === 0 ? (
					<p className="ww:text-xs ww:text-muted-foreground ww:text-center ww:py-8 ww:px-4">
						No sessions found in evals/sessions/
					</p>
				) : (
					sessions.map((s) => (
						<button
							key={s.name}
							type="button"
							onClick={() => {
								setSelected(s);
								setResult(null);
								setError(null);
							}}
							className={`ww:w-full ww:text-left ww:px-4 ww:py-2.5 ww:text-xs ww:border-b ww:border-border ww:hover:bg-muted/50 ww:transition-colors ${
								selected?.name === s.name ? "ww:bg-primary/10" : ""
							}`}
						>
							<span className="ww:block ww:font-medium ww:text-foreground ww:truncate">
								{s.name}
							</span>
							{s.mode && (
								<span className="ww:text-muted-foreground">{s.mode}</span>
							)}
						</button>
					))
				)}
			</div>

			{/* Run + results */}
			{selected && (
				<div className="ww:border-t ww:border-border ww:p-3 ww:space-y-3 ww:overflow-y-auto ww:max-h-[60%]">
					<button
						type="button"
						onClick={() => runSession(selected)}
						disabled={running}
						className="ww:w-full ww:py-1.5 ww:rounded-lg ww:text-xs ww:font-medium ww:bg-primary ww:text-primary-foreground ww:hover:opacity-90 ww:disabled:opacity-50 ww:transition-opacity"
					>
						{running ? "Running…" : "Run"}
					</button>

					{error && <p className="ww:text-xs ww:text-destructive">{error}</p>}

					{result && (
						<div className="ww:space-y-2">
							<div className="ww:flex ww:items-center ww:gap-2 ww:text-xs">
								<Dot pass={result.score === 1} />
								<span className="ww:text-muted-foreground">
									{Math.round(result.score * 100)}% assertions passed
								</span>
							</div>
							<div className="ww:space-y-1">
								{result.turns.map((turn, i) => (
									<TurnRow key={i} turn={turn} />
								))}
							</div>
						</div>
					)}
				</div>
			)}
		</div>
	);
}
