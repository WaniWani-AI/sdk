"use client";

import { type RefObject, useEffect, useRef, useState } from "react";
import type { ChatHandle } from "../@types";
import { cn } from "../lib/utils";

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

type MessageLike = {
	parts: Array<{ type: string; toolName?: string; text?: string }>;
};

function extractToolsCalled(message: MessageLike): string[] {
	return message.parts
		.filter((p) => p.type === "dynamic-tool" || p.type.startsWith("tool-"))
		.map((p) => p.toolName as string)
		.filter(Boolean);
}

function extractOutput(message: MessageLike): string {
	return message.parts
		.filter((p): p is { type: "text"; text: string } => p.type === "text")
		.map((p) => p.text)
		.join("");
}

// ---- Sub-components ----

function StatusLabel({ pass }: { pass: boolean | null }) {
	return (
		<span
			className={cn(
				"ww:font-mono ww:text-[10px] ww:font-semibold ww:uppercase ww:tracking-wider ww:shrink-0",
				pass === null && "ww:text-muted-foreground",
				pass === true && "ww:text-[#03d916]",
				pass === false && "ww:text-red-500",
			)}
		>
			{pass === null ? "SKIP" : pass ? "PASS" : "FAIL"}
		</span>
	);
}

function ScoreBar({ score }: { score: number }) {
	const pct = Math.round(score * 100);
	return (
		<div className="ww:space-y-1.5">
			<div className="ww:flex ww:items-baseline ww:justify-between">
				<span className="ww:text-xs ww:font-mono ww:font-semibold ww:text-foreground">
					{pct}%
				</span>
				<span className="ww:text-[10px] ww:text-muted-foreground ww:uppercase ww:tracking-wider ww:font-mono">
					{score === 1 ? "ALL PASS" : "ASSERTIONS"}
				</span>
			</div>
			<div className="ww:h-1 ww:w-full ww:rounded-full ww:bg-border">
				<div
					className={cn(
						"ww:h-full ww:rounded-full ww:transition-all ww:duration-500 ww:ease-out",
						score === 1
							? "ww:bg-[#03d916]"
							: score >= 0.5
								? "ww:bg-yellow-500"
								: "ww:bg-red-500",
					)}
					style={{ width: `${pct}%` }}
				/>
			</div>
		</div>
	);
}

function TurnRow({ turn, index }: { turn: TurnResult; index: number }) {
	const [open, setOpen] = useState(false);
	const allPass =
		turn.expectedTools.length === 0 ||
		turn.expectedTools.every((t) => turn.toolsCalled.includes(t));
	const status = turn.expectedTools.length > 0 ? allPass : null;

	return (
		<div
			className={cn(
				"ww:border-l-2 ww:pl-3",
				status === null && "ww:border-muted-foreground/30",
				status === true && "ww:border-[#03d916]",
				status === false && "ww:border-red-500",
				"ww:animate-[ww-fade-in_0.15s_ease-out_both]",
			)}
			style={{ animationDelay: `${index * 60}ms` }}
		>
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				className="ww:w-full ww:flex ww:items-center ww:gap-2 ww:py-1.5 ww:text-left"
			>
				<span
					className={cn(
						"ww:text-muted-foreground ww:text-[10px] ww:transition-transform ww:duration-150 ww:inline-block",
						open && "ww:rotate-90",
					)}
				>
					&#9654;
				</span>
				<span className="ww:text-xs ww:font-mono ww:text-foreground ww:truncate ww:flex-1">
					{turn.input}
				</span>
				<StatusLabel pass={status} />
			</button>

			<div
				className={cn(
					"ww:grid ww:transition-[grid-template-rows,opacity] ww:duration-200 ww:ease-out",
					open
						? "ww:grid-rows-[1fr] ww:opacity-100"
						: "ww:grid-rows-[0fr] ww:opacity-0",
				)}
			>
				<div className="ww:min-h-0 ww:overflow-hidden">
					<div className="ww:pb-2 ww:pt-1 ww:space-y-1 ww:ml-4">
						{turn.expectedTools.map((tool) => {
							const hit = turn.toolsCalled.includes(tool);
							return (
								<div
									key={tool}
									className="ww:flex ww:items-center ww:gap-2 ww:text-xs"
								>
									<StatusLabel pass={hit} />
									<span className="ww:font-mono ww:text-foreground/80">
										{tool}
									</span>
									{!hit && turn.toolsCalled.length > 0 && (
										<span className="ww:text-muted-foreground ww:font-mono">
											got [{turn.toolsCalled.join(", ")}]
										</span>
									)}
								</div>
							);
						})}
						{turn.expectedTools.length === 0 && turn.toolsCalled.length > 0 && (
							<div className="ww:text-xs ww:text-muted-foreground ww:font-mono">
								called: {turn.toolsCalled.join(", ")}
							</div>
						)}
						{turn.output && (
							<p className="ww:text-xs ww:text-muted-foreground ww:font-mono ww:line-clamp-2 ww:pt-1 ww:border-t ww:border-border/50">
								{turn.output}
							</p>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}

// ---- Main component ----

type EvalPanelProps = {
	/** API endpoint to fetch sessions from
	 *
	 * @default "/api/waniwani"
	 */
	api?: string;
	/** Ref to the ChatCard or ChatBar so eval turns flow through the chat UI */
	chatRef: RefObject<ChatHandle | null>;
};

/**
 * Dev-only evaluation panel for replaying recorded sessions and asserting tool usage.
 *
 * This component is automatically tree-shaken from production builds —
 * it returns `null` when `process.env.NODE_ENV === "production"`.
 *
 * To populate sessions, set `WANIWANI_EVAL=1` in your `.env` and add
 * session files to `evals/sessions/`.
 */
export function EvalPanel(props: EvalPanelProps) {
	if (process.env.NODE_ENV === "production") {
		return null;
	}

	return <EvalPanelInner {...props} />;
}

function EvalPanelInner({ api, chatRef }: EvalPanelProps) {
	const effectiveApi = api ?? "/api/waniwani";
	const [enabled, setEnabled] = useState<boolean | null>(null);
	const [sessions, setSessions] = useState<Session[]>([]);
	const [selected, setSelected] = useState<Session | null>(null);
	const [running, setRunning] = useState(false);
	const [result, setResult] = useState<RunResult | null>(null);
	const [error, setError] = useState<string | null>(null);
	const abortRef = useRef<AbortController | null>(null);

	useEffect(() => {
		fetch(`${effectiveApi}/config`)
			.then((r) => r.json())
			.then((data: { eval?: boolean }) => {
				setEnabled(data.eval === true);
			})
			.catch(() => setEnabled(false));
	}, [effectiveApi]);

	useEffect(() => {
		if (!enabled) {
			return;
		}
		fetch(`${effectiveApi}/sessions`)
			.then((r) => r.json())
			.then((data: Session[]) => {
				setSessions(data);
			})
			.catch(() => {});
	}, [effectiveApi, enabled]);

	async function runSession(session: Session) {
		abortRef.current?.abort();
		abortRef.current = new AbortController();
		setRunning(true);
		setResult(null);
		setError(null);

		try {
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

			if (!chatRef?.current) {
				throw new Error(
					"EvalPanel requires a chatRef prop pointing to the ChatCard/ChatBar",
				);
			}

			for (const { user, assistant } of userTurns) {
				const userText = getUserText(user);
				const expectedTools = assistant ? getRecordedTools(assistant) : [];

				const responseMessage = (await chatRef.current.sendMessageAndWait(
					userText,
				)) as MessageLike;

				const toolsCalled = extractToolsCalled(responseMessage);
				const output = extractOutput(responseMessage);

				turns.push({
					input: userText,
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

	if (!enabled) {
		return null;
	}

	function reloadSessions() {
		fetch(`${effectiveApi}/sessions`)
			.then((r) => r.json())
			.then((data: Session[]) => {
				setSessions(data);
			})
			.catch(() => {});
	}

	return (
		<div className="ww:flex ww:flex-col ww:h-full ww:overflow-hidden ww:text-foreground ww:border-l ww:border-border ww:pl-1 ww:min-w-[220px]">
			{/* Header */}
			<div className="ww:px-3 ww:py-2 ww:border-b ww:border-border/50 ww:flex ww:items-center ww:justify-between">
				<span className="ww:text-[10px] ww:font-mono ww:uppercase ww:tracking-widest ww:text-muted-foreground">
					Eval
				</span>
				<button
					type="button"
					onClick={reloadSessions}
					className="ww:text-muted-foreground ww:hover:text-foreground ww:transition-colors ww:cursor-pointer"
					title="Reload sessions"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						width="12"
						height="12"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
						role="img"
					>
						<title>Reload sessions</title>
						<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
						<path d="M21 3v5h-5" />
					</svg>
				</button>
			</div>

			{/* Session list */}
			<div className="ww:flex-1 ww:overflow-y-auto ww:min-h-0">
				{sessions.length === 0 ? (
					<p className="ww:text-xs ww:font-mono ww:text-muted-foreground ww:text-center ww:py-8 ww:px-4">
						No sessions found
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
							className={cn(
								"ww:w-full ww:text-left ww:px-3 ww:py-2 ww:text-xs ww:font-mono ww:transition-colors ww:border-l-2",
								selected?.name === s.name
									? "ww:border-[#03d916] ww:bg-[#03d916]/5 ww:text-foreground"
									: "ww:border-transparent ww:text-foreground/70 ww:hover:text-foreground ww:hover:bg-muted/30",
							)}
						>
							<span className="ww:block ww:truncate">{s.name}</span>
						</button>
					))
				)}
			</div>

			{/* Run + results */}
			{selected && (
				<div className="ww:border-t ww:border-border/50 ww:p-3 ww:space-y-3 ww:overflow-y-auto ww:max-h-[60%]">
					<button
						type="button"
						onClick={() => runSession(selected)}
						disabled={running}
						className="ww:w-full ww:py-2 ww:rounded-md ww:text-xs ww:font-mono ww:font-medium ww:bg-foreground ww:text-background ww:hover:opacity-90 ww:disabled:opacity-50 ww:transition-opacity ww:cursor-pointer"
					>
						{running ? "Running..." : "Run session"}
					</button>

					{error && (
						<div className="ww:border-l-2 ww:border-red-500 ww:pl-3 ww:py-1">
							<p className="ww:text-xs ww:font-mono ww:text-red-500">{error}</p>
						</div>
					)}

					{result && (
						<div className="ww:space-y-3 ww:animate-[ww-fade-in_0.2s_ease-out_both]">
							<ScoreBar score={result.score} />
							<div className="ww:space-y-1">
								{result.turns.map((turn, i) => (
									<TurnRow key={i} turn={turn} index={i} />
								))}
							</div>
						</div>
					)}
				</div>
			)}
		</div>
	);
}
