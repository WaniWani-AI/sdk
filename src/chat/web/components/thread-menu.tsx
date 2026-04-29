"use client";

import { useEffect, useRef, useState } from "react";
import type { StoredThread } from "../lib/thread-store";

interface ThreadMenuProps {
	threads: StoredThread[];
	activeThreadId?: string;
	onNewThread: () => void;
	onSelectThread: (threadId: string) => void;
	onDeleteThread: (threadId: string) => void;
}

const VISIBLE_THREAD_LIMIT = 20;

function formatRelative(iso: string): string {
	const then = Date.parse(iso);
	if (Number.isNaN(then)) {
		return "";
	}
	const diff = Date.now() - then;
	if (diff < 60_000) {
		return "just now";
	}
	if (diff < 60 * 60_000) {
		return `${Math.floor(diff / 60_000)}m ago`;
	}
	if (diff < 24 * 60 * 60_000) {
		return `${Math.floor(diff / (60 * 60_000))}h ago`;
	}
	const days = Math.floor(diff / (24 * 60 * 60_000));
	return `${days}d ago`;
}

function PlusIcon() {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			width="16"
			height="16"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			role="img"
			aria-label="New chat"
		>
			<title>New chat</title>
			<line x1="12" y1="5" x2="12" y2="19" />
			<line x1="5" y1="12" x2="19" y2="12" />
		</svg>
	);
}

function HistoryIcon() {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			width="16"
			height="16"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			role="img"
			aria-label="Thread history"
		>
			<title>Thread history</title>
			<path d="M3 12a9 9 0 1 0 3-6.7" />
			<polyline points="3 4 3 9 8 9" />
			<line x1="12" y1="7" x2="12" y2="12" />
			<line x1="12" y1="12" x2="15" y2="14" />
		</svg>
	);
}

function TrashIcon() {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			width="14"
			height="14"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			role="img"
			aria-label="Delete thread"
		>
			<title>Delete thread</title>
			<polyline points="3 6 5 6 21 6" />
			<path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
			<path d="M10 11v6" />
			<path d="M14 11v6" />
		</svg>
	);
}

export function ThreadMenu({
	threads,
	activeThreadId,
	onNewThread,
	onSelectThread,
	onDeleteThread,
}: ThreadMenuProps) {
	const [open, setOpen] = useState(false);
	const containerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) {
			return;
		}
		const handler = (event: MouseEvent) => {
			if (
				containerRef.current &&
				!containerRef.current.contains(event.target as Node)
			) {
				setOpen(false);
			}
		};
		document.addEventListener("mousedown", handler);
		return () => document.removeEventListener("mousedown", handler);
	}, [open]);

	const visible = threads.slice(0, VISIBLE_THREAD_LIMIT);
	const hidden = Math.max(0, threads.length - VISIBLE_THREAD_LIMIT);

	return (
		<div
			ref={containerRef}
			className="ww:relative ww:flex ww:items-center ww:gap-1"
		>
			<button
				type="button"
				onClick={onNewThread}
				title="New chat"
				aria-label="New chat"
				className="ww:p-1.5 ww:rounded-md ww:text-muted-foreground hover:ww:text-foreground hover:ww:bg-foreground/5 ww:transition-colors ww:cursor-pointer"
			>
				<PlusIcon />
			</button>
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				title="Thread history"
				aria-label="Thread history"
				aria-expanded={open}
				className="ww:p-1.5 ww:rounded-md ww:text-muted-foreground hover:ww:text-foreground hover:ww:bg-foreground/5 ww:transition-colors ww:cursor-pointer"
			>
				<HistoryIcon />
			</button>
			{open && (
				<div
					role="menu"
					className="ww:absolute ww:right-0 ww:top-full ww:mt-1 ww:w-72 ww:max-h-80 ww:overflow-y-auto ww:rounded-lg ww:border ww:border-border ww:bg-background ww:shadow-lg ww:z-50"
				>
					{visible.length === 0 && (
						<div className="ww:px-3 ww:py-3 ww:text-xs ww:text-muted-foreground">
							No previous chats yet.
						</div>
					)}
					{visible.map((thread) => {
						const isActive = thread.threadId === activeThreadId;
						return (
							<div
								key={thread.threadId}
								className={`ww:flex ww:items-center ww:gap-2 ww:px-3 ww:py-2 ww:text-xs hover:ww:bg-foreground/5 ${
									isActive ? "ww:bg-foreground/5" : ""
								}`}
							>
								<button
									type="button"
									onClick={() => {
										onSelectThread(thread.threadId);
										setOpen(false);
									}}
									className="ww:flex-1 ww:min-w-0 ww:text-left ww:cursor-pointer"
								>
									<div className="ww:truncate ww:text-foreground ww:font-medium">
										{thread.title}
									</div>
									<div className="ww:text-[10px] ww:text-muted-foreground">
										{formatRelative(thread.updatedAt)}
									</div>
								</button>
								<button
									type="button"
									onClick={(e) => {
										e.stopPropagation();
										onDeleteThread(thread.threadId);
									}}
									title="Delete thread"
									aria-label="Delete thread"
									className="ww:p-1 ww:rounded ww:text-muted-foreground hover:ww:text-foreground hover:ww:bg-foreground/10 ww:transition-colors ww:cursor-pointer"
								>
									<TrashIcon />
								</button>
							</div>
						);
					})}
					{hidden > 0 && (
						<div className="ww:px-3 ww:py-2 ww:text-[10px] ww:text-muted-foreground ww:border-t ww:border-border">
							{hidden} older thread{hidden === 1 ? "" : "s"} hidden
						</div>
					)}
				</div>
			)}
		</div>
	);
}
