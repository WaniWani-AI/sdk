"use client";

import {
	type KeyboardEvent,
	type RefObject,
	useEffect,
	useRef,
	useState,
} from "react";
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

// ---- Icons ----

function PlayIcon({ className }: { className?: string }) {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			width="12"
			height="12"
			viewBox="0 0 24 24"
			fill="currentColor"
			stroke="none"
			className={className}
			role="img"
		>
			<title>Run scenario</title>
			<path d="M6 4l15 8-15 8V4z" />
		</svg>
	);
}

function PencilIcon({ className }: { className?: string }) {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			width="11"
			height="11"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			className={className}
			role="img"
		>
			<title>Rename scenario</title>
			<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
		</svg>
	);
}

function LoaderIcon({ className }: { className?: string }) {
	return (
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
			className={cn("ww:animate-spin", className)}
			role="img"
		>
			<title>Running</title>
			<path d="M12 2v4" />
			<path d="M12 18v4" />
			<path d="m4.93 4.93 2.83 2.83" />
			<path d="m16.24 16.24 2.83 2.83" />
			<path d="M2 12h4" />
			<path d="M18 12h4" />
			<path d="m4.93 19.07 2.83-2.83" />
			<path d="m16.24 4.93 2.83 2.83" />
		</svg>
	);
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

function InlineRenameInput({
	initialName,
	onSave,
	onCancel,
}: {
	initialName: string;
	onSave: (name: string) => void;
	onCancel: () => void;
}) {
	const inputRef = useRef<HTMLInputElement>(null);
	const doneRef = useRef(false);
	const [value, setValue] = useState(initialName);

	useEffect(() => {
		inputRef.current?.focus();
		inputRef.current?.select();
	}, []);

	function commit() {
		if (doneRef.current) {
			return;
		}
		doneRef.current = true;
		const trimmed = value.trim();
		if (trimmed && trimmed !== initialName) {
			onSave(trimmed);
		} else {
			onCancel();
		}
	}

	function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
		if (e.key === "Enter") {
			commit();
		} else if (e.key === "Escape") {
			doneRef.current = true;
			onCancel();
		}
	}

	return (
		<input
			ref={inputRef}
			type="text"
			value={value}
			onChange={(e) => setValue(e.target.value)}
			onKeyDown={handleKeyDown}
			onBlur={commit}
			className="ww:w-full ww:bg-transparent ww:text-xs ww:font-mono ww:text-foreground ww:outline-none ww:border-b ww:border-foreground/30 ww:py-0.5"
		/>
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
	const [runningId, setRunningId] = useState<string | null>(null);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [renameError, setRenameError] = useState<string | null>(null);
	const abortRef = useRef<AbortController | null>(null);
	const config = useConfig(effectiveApi);
	const { scenarios, isLoading, reload, rename } = useScenarios(
		effectiveApi,
		config.eval,
	);

	async function runScenario(scenario: EvalScenario) {
		abortRef.current?.abort();
		abortRef.current = new AbortController();
		setRunningId(scenario.id);

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
			setRunningId(null);
		}
	}

	async function handleRename(id: string, newName: string) {
		setRenameError(null);
		try {
			await rename(id, newName);
		} catch (e) {
			const msg = e instanceof Error ? e.message : "Failed to rename scenario";
			setRenameError(msg);
		}
		setEditingId(null);
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

			{/* Rename error */}
			{renameError && (
				<div className="ww:mx-3 ww:my-2 ww:px-2 ww:py-1.5 ww:text-[11px] ww:font-mono ww:text-red-400 ww:bg-red-500/10 ww:rounded ww:flex ww:items-start ww:gap-1.5">
					<span className="ww:flex-1">{renameError}</span>
					<button
						type="button"
						onClick={() => setRenameError(null)}
						className="ww:shrink-0 ww:text-red-400 ww:hover:text-red-300 ww:cursor-pointer"
					>
						&times;
					</button>
				</div>
			)}

			{/* Scenario list */}
			<div className="ww:flex-1 ww:overflow-y-auto ww:min-h-0">
				{isLoading ? (
					<ScenarioSkeleton />
				) : scenarios.length === 0 ? (
					<p className="ww:text-xs ww:font-mono ww:text-muted-foreground ww:text-center ww:py-8 ww:px-4">
						No scenarios found
					</p>
				) : (
					scenarios.map((s) => {
						const isRunning = runningId === s.id;
						const isEditing = editingId === s.id;

						return (
							<div
								key={s.id}
								className={cn(
									"ww:group ww:flex ww:items-center ww:gap-1 ww:px-3 ww:py-2 ww:border-l-2 ww:transition-colors",
									isRunning
										? "ww:border-[#03d916] ww:bg-[#03d916]/10"
										: "ww:border-transparent ww:hover:bg-muted/50",
								)}
							>
								{/* Play / spinner */}
								<button
									type="button"
									onClick={() => runScenario(s)}
									disabled={runningId !== null}
									className="ww:shrink-0 ww:text-muted-foreground ww:hover:text-[#03d916] ww:disabled:opacity-40 ww:transition-colors ww:cursor-pointer ww:p-0.5"
									title="Run scenario"
								>
									{isRunning ? <LoaderIcon /> : <PlayIcon />}
								</button>

								{/* Name (inline editable) */}
								<div className="ww:flex-1 ww:min-w-0">
									{isEditing ? (
										<InlineRenameInput
											initialName={s.name}
											onSave={(name) => handleRename(s.id, name)}
											onCancel={() => setEditingId(null)}
										/>
									) : (
										<button
											type="button"
											className="ww:block ww:truncate ww:text-xs ww:font-mono ww:text-foreground ww:cursor-default ww:bg-transparent ww:border-none ww:p-0 ww:text-left"
											onDoubleClick={() => setEditingId(s.id)}
											onKeyDown={(e) => {
												if (e.key === "F2") {
													setEditingId(s.id);
												}
											}}
											title={s.name}
										>
											{s.name}
										</button>
									)}
								</div>

								{/* Rename button */}
								{!isEditing && !isRunning && (
									<button
										type="button"
										onClick={() => setEditingId(s.id)}
										className="ww:shrink-0 ww:opacity-0 ww:group-hover:opacity-100 ww:text-muted-foreground ww:hover:text-foreground ww:transition-all ww:cursor-pointer ww:p-0.5"
										title="Rename scenario"
									>
										<PencilIcon />
									</button>
								)}
							</div>
						);
					})
				)}
			</div>
		</div>
	);
}
