"use client";

import { type RefObject, useRef, useState } from "react";
import type { ChatHandle } from "../@types";
import { useConfig } from "../hooks/use-config";
import { type EvalScenario, useScenarios } from "../hooks/use-scenarios";
import { cn } from "../lib/utils";

// ---- Types ----

type ScenarioPart = { type: string; [key: string]: unknown };
type ScenarioMessage = {
	id: string;
	role: "user" | "assistant" | "system" | "data";
	parts: ScenarioPart[];
};

// ---- Replay helpers ----

function getUserText(msg: ScenarioMessage): string {
	return msg.parts
		.filter(
			(p): p is { type: "text"; text: string } =>
				p.type === "text" && typeof (p as { text?: unknown }).text === "string",
		)
		.map((p) => p.text)
		.join("");
}

// ---- Sub-components ----

function ScenarioSkeleton() {
	return (
		<div className="ww:px-3 ww:py-2 ww:space-y-3">
			{[1, 2, 3, 4].map((i) => (
				<div key={i} className="ww:flex ww:items-center ww:gap-2">
					<div className="ww:h-1.5 ww:w-1.5 ww:rounded-full ww:bg-muted-foreground/20 ww:shrink-0 ww:animate-pulse" />
					<div
						className="ww:h-3.5 ww:rounded ww:bg-muted-foreground/10 ww:animate-pulse"
						style={{ width: `${50 + i * 10}%`, animationDelay: `${i * 100}ms` }}
					/>
				</div>
			))}
		</div>
	);
}

// ---- Main component ----

const PANEL_WIDTH = 320;

type ScenarioPanelProps = {
	/** API endpoint to fetch scenarios from
	 *
	 * @default "/api/waniwani"
	 */
	api?: string;
	/** Ref to the ChatCard or ChatBar so scenario turns flow through the chat UI */
	chatRef: RefObject<ChatHandle | null>;
};

/**
 * Dev-only scenario panel for replaying recorded scenarios through the chat.
 *
 * This component is automatically tree-shaken from production builds —
 * it returns `null` when `process.env.NODE_ENV === "production"`.
 *
 * To populate scenarios, set `WANIWANI_EVAL=1` in your `.env` and add
 * scenario files to `evals/scenarios/`.
 */
export function ScenarioPanel({ api, chatRef }: ScenarioPanelProps) {
	const effectiveApi = api ?? "/api/waniwani";
	const [selected, setSelected] = useState<EvalScenario | null>(null);
	const [running, setRunning] = useState(false);
	const abortRef = useRef<AbortController | null>(null);
	const config = useConfig(effectiveApi);
	const { scenarios, isLoading, reload } = useScenarios(
		effectiveApi,
		config.eval,
	);

	async function runScenario(scenario: EvalScenario) {
		abortRef.current?.abort();
		abortRef.current = new AbortController();
		setRunning(true);

		try {
			if (!chatRef?.current) {
				throw new Error(
					"ScenarioPanel requires a chatRef prop pointing to the ChatCard/ChatBar",
				);
			}

			chatRef.current.reset();

			const userMessages = scenario.messages.filter(
				(msg) => msg.role === "user",
			);

			for (const msg of userMessages) {
				const text = getUserText(msg);
				if (text) {
					await chatRef.current.sendMessageAndWait(text);
				}
			}
		} catch (e) {
			if ((e as Error).name !== "AbortError") {
				console.error("[ScenarioPanel] run failed:", e);
			}
		} finally {
			setRunning(false);
		}
	}

	if (!config.eval) {
		return null;
	}

	return (
		<div
			className="ww:flex ww:flex-col ww:h-full ww:overflow-hidden ww:text-foreground ww:border-l ww:border-border ww:shrink-0"
			style={{ width: PANEL_WIDTH }}
		>
			{/* Header */}
			<div className="ww:px-3 ww:py-2 ww:border-b ww:border-border/50 ww:flex ww:items-center ww:justify-between">
				<span className="ww:text-[10px] ww:font-mono ww:uppercase ww:tracking-widest ww:text-muted-foreground">
					Scenarios
				</span>
				<button
					type="button"
					onClick={reload}
					className="ww:text-muted-foreground ww:hover:text-foreground ww:transition-colors ww:cursor-pointer"
					title="Reload scenarios"
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
						<title>Reload scenarios</title>
						<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
						<path d="M21 3v5h-5" />
					</svg>
				</button>
			</div>

			{/* Scenario list */}
			<div className="ww:flex-1 ww:overflow-y-auto ww:min-h-0">
				{isLoading ? (
					<ScenarioSkeleton />
				) : scenarios.length === 0 ? (
					<p className="ww:text-xs ww:font-mono ww:text-muted-foreground ww:text-center ww:py-8 ww:px-4">
						No scenarios found
					</p>
				) : (
					scenarios.map((s) => (
						<button
							key={s.name}
							type="button"
							onClick={() => setSelected(s)}
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

			{/* Run */}
			{selected && (
				<div className="ww:border-t ww:border-border/50 ww:p-3">
					<button
						type="button"
						onClick={() => runScenario(selected)}
						disabled={running}
						className="ww:w-full ww:py-2 ww:rounded-md ww:text-xs ww:font-mono ww:font-medium ww:bg-foreground ww:text-background ww:hover:opacity-90 ww:disabled:opacity-50 ww:transition-opacity ww:cursor-pointer"
					>
						{running ? "Running..." : "Run scenario"}
					</button>
				</div>
			)}
		</div>
	);
}
