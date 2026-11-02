"use client";

import { useEffect, useRef, useState } from "react";
import { HOOKS } from "../hooks-contract";
import { parseCssDuration } from "../lib/css-duration";
import { cn } from "../lib/utils";

const DEFAULT_TOAST_DURATION_MS = 2200;
const DEFAULT_TOAST_LEAVE_MS = 200;

type ToastState = "entering" | "shown" | "leaving" | "gone";

interface ToastProps {
	message: string;
	kind?: "success" | "error";
	durationMs: number;
	leaveMs?: number;
	onDone?: () => void;
}

export function Toast({
	message,
	kind = "success",
	durationMs,
	leaveMs = DEFAULT_TOAST_LEAVE_MS,
	onDone,
}: ToastProps) {
	const [state, setState] = useState<ToastState>("entering");
	const onDoneRef = useRef(onDone);
	onDoneRef.current = onDone;

	useEffect(() => {
		const frame = requestAnimationFrame(() => setState("shown"));
		const leave = setTimeout(() => setState("leaving"), durationMs);
		const gone = setTimeout(() => {
			setState("gone");
			onDoneRef.current?.();
		}, durationMs + leaveMs);
		return () => {
			cancelAnimationFrame(frame);
			clearTimeout(leave);
			clearTimeout(gone);
		};
	}, [durationMs, leaveMs]);

	if (state === "gone") {
		return null;
	}

	return (
		<output
			aria-live="polite"
			data-kind={kind}
			data-state={state}
			className={cn(
				HOOKS.toast,
				"ww:absolute ww:left-1/2 ww:bottom-24 ww:z-50 ww:-translate-x-1/2 ww:rounded-full ww:border ww:border-border ww:bg-background ww:px-4 ww:py-1.5 ww:text-sm ww:font-medium ww:text-foreground ww:shadow-md ww:whitespace-nowrap ww:pointer-events-none ww:transition-[opacity,translate] ww:duration-200 ww:data-[state=leaving]:duration-(--ww-toast-leave-duration)",
				"ww:data-[state=entering]:opacity-0 ww:data-[state=entering]:translate-y-2 ww:data-[state=leaving]:opacity-0 ww:data-[state=leaving]:translate-y-2",
			)}
		>
			{message}
		</output>
	);
}

export function readToastTiming(element: Element | null): {
	durationMs: number;
	leaveMs: number;
} {
	if (!element || typeof getComputedStyle !== "function") {
		return {
			durationMs: DEFAULT_TOAST_DURATION_MS,
			leaveMs: DEFAULT_TOAST_LEAVE_MS,
		};
	}
	const root = element.closest(`.${HOOKS.root}`) ?? element;
	const style = getComputedStyle(root);
	return {
		durationMs:
			parseCssDuration(style.getPropertyValue("--ww-toast-duration")) ??
			DEFAULT_TOAST_DURATION_MS,
		leaveMs:
			parseCssDuration(style.getPropertyValue("--ww-toast-leave-duration")) ??
			DEFAULT_TOAST_LEAVE_MS,
	};
}
