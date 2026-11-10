"use client";

import { EllipsisIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { MenuAction } from "../embed/config";
import { formatRelativeTime, useTranslation } from "../i18n";
import { type StoredThread, VISIBLE_THREAD_LIMIT } from "../lib/thread-store";
import { cn } from "../lib/utils";
import { PARTS } from "../parts";
import { ConfirmDialog } from "./confirm-dialog";
import { HEADER_ICON_BUTTON } from "./header-icon-button";
import { readToastTiming, Toast } from "./toast";

interface ChatMenuProps {
	actions: MenuAction[];
	restartConfirm?: boolean;
	onNewChat: () => void;
	onRestart: () => void;
	onCopy: () => Promise<boolean>;
	threads?: StoredThread[];
	activeThreadId?: string;
	onSelectThread?: (threadId: string) => void;
	onDeleteThread?: (threadId: string) => void;
}

type CopyStatus = "idle" | "copied" | "failed";

const COPY_STATUS_MS = 3000;

const ITEM_CLASS =
	"ww:flex ww:w-full ww:items-center ww:gap-2 ww:rounded-md ww:px-3 ww:py-2 ww:text-left ww:text-sm ww:cursor-pointer ww:hover:bg-foreground/5 ww:disabled:cursor-default ww:disabled:opacity-50";

export function ChatMenu({
	actions,
	restartConfirm = false,
	onNewChat,
	onRestart,
	onCopy,
	threads = [],
	activeThreadId,
	onSelectThread,
	onDeleteThread,
}: ChatMenuProps) {
	const { locale, t } = useTranslation();
	const [open, setOpen] = useState(false);
	const [view, setView] = useState<"actions" | "history">("actions");
	const [copyStatus, setCopyStatus] = useState<CopyStatus>("idle");
	const [dialogOpen, setDialogOpen] = useState(false);
	const [dialogError, setDialogError] = useState<string>();
	const [dialogBusy, setDialogBusy] = useState(false);
	const [toast, setToast] = useState<{
		id: number;
		durationMs: number;
		leaveMs: number;
	}>();
	const containerRef = useRef<HTMLDivElement>(null);
	const buttonRef = useRef<HTMLButtonElement>(null);
	const copyTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
	const toastIdRef = useRef(0);

	useEffect(() => () => clearTimeout(copyTimerRef.current), []);

	useEffect(() => {
		if (!open) {
			return;
		}
		const close = () => {
			setOpen(false);
			setView("actions");
		};
		const onPointerDown = (event: MouseEvent) => {
			const container = containerRef.current;
			// Inside the embed's shadow root `event.target` is retargeted to the
			// host; `composedPath()` still holds the real click target.
			if (container && !event.composedPath().includes(container)) {
				close();
			}
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				close();
				buttonRef.current?.focus();
			}
		};
		document.addEventListener("mousedown", onPointerDown);
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("mousedown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [open]);

	const offersCopy = actions.includes("copy-conversation");

	function closeMenu() {
		setOpen(false);
		setView("actions");
	}

	function showCopiedToast() {
		toastIdRef.current += 1;
		setToast({
			id: toastIdRef.current,
			...readToastTiming(containerRef.current),
		});
	}

	async function copyConversation() {
		const copied = await onCopy();
		clearTimeout(copyTimerRef.current);
		setCopyStatus(copied ? "copied" : "failed");
		copyTimerRef.current = setTimeout(
			() => setCopyStatus("idle"),
			COPY_STATUS_MS,
		);
		if (copied) {
			showCopiedToast();
		}
	}

	function requestRestart() {
		closeMenu();
		if (restartConfirm) {
			setDialogError(undefined);
			setDialogOpen(true);
		} else {
			onRestart();
		}
	}

	function closeDialog() {
		setDialogOpen(false);
		setDialogError(undefined);
		buttonRef.current?.focus();
	}

	function clearConversation() {
		closeDialog();
		onRestart();
	}

	async function confirmRestart() {
		if (!offersCopy) {
			clearConversation();
			return;
		}
		setDialogBusy(true);
		const copied = await onCopy();
		setDialogBusy(false);
		if (!copied) {
			setDialogError(t.dialog.copyError);
			return;
		}
		clearConversation();
		showCopiedToast();
	}

	function runAction(action: MenuAction) {
		switch (action) {
			case "new-chat":
				closeMenu();
				onNewChat();
				return;
			case "restart":
				requestRestart();
				return;
			case "copy-conversation":
				void copyConversation();
				return;
			case "history":
				setView("history");
				return;
			case "delete":
				closeMenu();
				if (activeThreadId) {
					onDeleteThread?.(activeThreadId);
				}
				return;
		}
	}

	function labelFor(action: MenuAction): string {
		switch (action) {
			case "new-chat":
				return t.menu.newChat;
			case "restart":
				return t.menu.restart;
			case "copy-conversation":
				if (copyStatus === "copied") {
					return t.menu.copied;
				}
				return copyStatus === "failed"
					? t.menu.copyFailed
					: t.menu.copyConversation;
			case "history":
				return t.threadMenu.threadHistory;
			case "delete":
				return t.threadMenu.deleteThread;
		}
	}

	const visibleThreads = threads.slice(0, VISIBLE_THREAD_LIMIT);

	return (
		<>
			<div ref={containerRef} className="ww:relative ww:flex ww:items-center">
				<button
					ref={buttonRef}
					type="button"
					onClick={() => (open ? closeMenu() : setOpen(true))}
					aria-label={t.menu.label}
					aria-haspopup="menu"
					aria-expanded={open}
					data-state={open ? "open" : "closed"}
					className={cn(PARTS.menuButton, HEADER_ICON_BUTTON)}
				>
					<EllipsisIcon className="ww:size-4" strokeWidth={1.75} aria-hidden />
				</button>
				{open && (
					<div
						role="menu"
						aria-label={t.menu.label}
						className={cn(
							PARTS.menu,
							"ww:absolute ww:right-0 ww:top-full ww:z-50 ww:mt-1 ww:min-w-[200px] ww:max-w-72 ww:max-h-80 ww:overflow-y-auto ww:rounded-lg ww:border ww:border-border ww:bg-background ww:p-1 ww:text-foreground ww:shadow-lg",
						)}
					>
						{view === "actions" &&
							actions.map((action) => (
								<button
									key={action}
									type="button"
									role="menuitem"
									data-action={action}
									data-state={
										action === "copy-conversation" ? copyStatus : undefined
									}
									disabled={action === "delete" && !activeThreadId}
									onClick={() => runAction(action)}
									className={cn(PARTS.menuItem, ITEM_CLASS)}
								>
									{labelFor(action)}
								</button>
							))}
						{view === "history" && visibleThreads.length === 0 && (
							<div className="ww:px-3 ww:py-2 ww:text-xs ww:text-muted-foreground">
								{t.threadMenu.noPreviousChats}
							</div>
						)}
						{view === "history" &&
							visibleThreads.map((thread) => {
								const updatedAtMs = Date.parse(thread.updatedAt);
								return (
									<button
										key={thread.threadId}
										type="button"
										role="menuitem"
										data-action="open-thread"
										aria-current={
											thread.threadId === activeThreadId ? "true" : undefined
										}
										onClick={() => {
											closeMenu();
											onSelectThread?.(thread.threadId);
										}}
										className={cn(
											PARTS.menuItem,
											ITEM_CLASS,
											"ww:flex-col ww:items-start ww:gap-0",
										)}
									>
										<span className="ww:w-full ww:truncate ww:font-medium">
											{thread.title}
										</span>
										<span className="ww:text-[10px] ww:text-muted-foreground">
											{Number.isNaN(updatedAtMs)
												? ""
												: formatRelativeTime(updatedAtMs, locale)}
										</span>
									</button>
								);
							})}
					</div>
				)}
			</div>
			{restartConfirm && actions.includes("restart") && (
				<ConfirmDialog
					open={dialogOpen}
					title={t.dialog.restartTitle}
					text={t.dialog.restartText}
					primary={offersCopy ? t.dialog.copyAndClear : t.dialog.confirm}
					secondary={offersCopy ? t.dialog.clearWithoutCopy : t.dialog.cancel}
					error={dialogError}
					busy={dialogBusy}
					onPrimary={() => void confirmRestart()}
					onSecondary={offersCopy ? clearConversation : closeDialog}
					onClose={closeDialog}
				/>
			)}
			{toast && (
				<Toast
					key={toast.id}
					message={t.toast.conversationCopied}
					durationMs={toast.durationMs}
					leaveMs={toast.leaveMs}
					onDone={() => setToast(undefined)}
				/>
			)}
		</>
	);
}
