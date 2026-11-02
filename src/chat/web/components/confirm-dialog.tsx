"use client";

import { XIcon } from "lucide-react";
import {
	type KeyboardEvent,
	type MouseEvent,
	useEffect,
	useId,
	useRef,
} from "react";
import { useTranslation } from "../i18n";
import { cn } from "../lib/utils";
import { PARTS } from "../parts";

interface ConfirmDialogProps {
	open: boolean;
	title: string;
	text: string;
	primary: string;
	secondary: string;
	error?: string;
	busy?: boolean;
	onPrimary: () => void;
	onSecondary: () => void;
	onClose: () => void;
}

const FOCUSABLE =
	"button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])";

function showDialog(dialog: HTMLDialogElement) {
	if (typeof dialog.showModal === "function") {
		try {
			dialog.showModal();
			return;
		} catch {}
	}
	dialog.setAttribute("open", "");
}

function hideDialog(dialog: HTMLDialogElement) {
	if (typeof dialog.close === "function") {
		dialog.close();
	}
	dialog.removeAttribute("open");
}

function wrapFocus(event: KeyboardEvent<HTMLDialogElement>) {
	const focusable = Array.from(
		event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE),
	);
	const first = focusable[0];
	const last = focusable[focusable.length - 1];
	if (!first || !last) {
		return;
	}
	const active = (event.currentTarget.getRootNode() as Document | ShadowRoot)
		.activeElement;
	if (event.shiftKey && active === first) {
		event.preventDefault();
		last.focus();
	} else if (!event.shiftKey && active === last) {
		event.preventDefault();
		first.focus();
	}
}

/** The dialog itself is the target on its padding too, so the point must also fall outside its box. */
function isBackdropClick(event: MouseEvent<HTMLDialogElement>): boolean {
	const dialog = event.currentTarget;
	if (event.target !== dialog) {
		return false;
	}
	const box = dialog.getBoundingClientRect();
	return (
		event.clientX < box.left ||
		event.clientX > box.right ||
		event.clientY < box.top ||
		event.clientY > box.bottom
	);
}

export function ConfirmDialog({
	open,
	title,
	text,
	primary,
	secondary,
	error,
	busy = false,
	onPrimary,
	onSecondary,
	onClose,
}: ConfirmDialogProps) {
	const { t } = useTranslation();
	const dialogRef = useRef<HTMLDialogElement>(null);
	const primaryRef = useRef<HTMLButtonElement>(null);
	const titleId = useId();
	const textId = useId();

	useEffect(() => {
		const dialog = dialogRef.current;
		if (!dialog) {
			return;
		}
		if (open && !dialog.hasAttribute("open")) {
			showDialog(dialog);
			primaryRef.current?.focus();
		} else if (!open && dialog.hasAttribute("open")) {
			hideDialog(dialog);
		}
	}, [open]);

	return (
		<dialog
			ref={dialogRef}
			aria-labelledby={titleId}
			aria-describedby={textId}
			onCancel={(event) => {
				event.preventDefault();
				onClose();
			}}
			onClick={(event) => {
				if (isBackdropClick(event)) {
					onClose();
				}
			}}
			onKeyDown={(event) => {
				if (event.key === "Escape") {
					event.preventDefault();
					onClose();
				} else if (event.key === "Tab") {
					wrapFocus(event);
				}
			}}
			className={cn(
				PARTS.dialog,
				"ww:pointer-events-auto ww:fixed ww:inset-0 ww:m-auto ww:h-fit ww:w-[calc(100%-2rem)] ww:max-w-[520px] ww:rounded-2xl ww:border ww:border-border ww:bg-background ww:p-6 ww:text-foreground ww:shadow-xl ww:backdrop:bg-black/40",
			)}
		>
			<button
				type="button"
				onClick={onClose}
				aria-label={t.dialog.close}
				title={t.dialog.close}
				className={cn(
					PARTS.dialogClose,
					"ww:absolute ww:right-3 ww:top-3 ww:rounded-md ww:p-1.5 ww:text-muted-foreground ww:transition-colors ww:cursor-pointer ww:hover:bg-foreground/5 ww:hover:text-foreground",
				)}
			>
				<XIcon className="ww:size-4" aria-hidden />
			</button>
			<h2
				id={titleId}
				className={cn(
					PARTS.dialogTitle,
					"ww:pr-8 ww:text-lg ww:font-semibold ww:leading-snug",
				)}
			>
				{title}
			</h2>
			<div
				id={textId}
				className={cn(
					PARTS.dialogText,
					"ww:mt-2 ww:text-sm ww:text-muted-foreground",
				)}
			>
				<p>{text}</p>
				{error && (
					<p role="alert" className="ww:mt-3 ww:text-destructive">
						{error}
					</p>
				)}
			</div>
			<div
				className={cn(
					PARTS.dialogActions,
					"ww:mt-6 ww:flex ww:flex-wrap ww:justify-end ww:gap-2",
				)}
			>
				<button
					type="button"
					onClick={onSecondary}
					className={cn(
						PARTS.dialogSecondary,
						"ww:rounded-lg ww:border ww:border-border ww:px-4 ww:py-2 ww:text-sm ww:font-medium ww:transition-colors ww:cursor-pointer ww:hover:bg-foreground/5",
					)}
				>
					{secondary}
				</button>
				<button
					ref={primaryRef}
					type="button"
					onClick={onPrimary}
					disabled={busy}
					className={cn(
						PARTS.dialogPrimary,
						"ww:rounded-lg ww:bg-primary ww:px-4 ww:py-2 ww:text-sm ww:font-medium ww:text-primary-foreground ww:transition-colors ww:cursor-pointer ww:hover:bg-primary/90 ww:disabled:opacity-60",
					)}
				>
					{primary}
				</button>
			</div>
		</dialog>
	);
}
