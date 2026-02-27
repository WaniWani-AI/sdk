"use client";

import type { WidgetEvent } from "./widget-transport";

type Enqueue = (events: WidgetEvent[]) => void;

interface AutoCaptureConfig {
	sessionId?: string;
	traceId?: string;
	metadata?: Record<string, unknown>;
}

function eventId(): string {
	return crypto.randomUUID();
}

function baseFields(
	config: AutoCaptureConfig,
	eventType: string,
	extra?: Record<string, unknown>,
): WidgetEvent {
	return {
		event_id: eventId(),
		event_type: eventType,
		timestamp: new Date().toISOString(),
		source: "widget",
		session_id: config.sessionId,
		trace_id: config.traceId,
		...extra,
	};
}

function isFormField(el: HTMLElement): boolean {
	const tag = el.tagName.toLowerCase();
	return tag === "input" || tag === "textarea" || tag === "select";
}

/**
 * Initialize all auto-capture DOM listeners. Returns a cleanup function.
 */
export function initAutoCapture(
	config: AutoCaptureConfig,
	enqueue: Enqueue,
): () => void {
	const cleanups: Array<() => void> = [];

	// ── widget_render ──────────────────────────────────────────────────
	const nav = typeof navigator !== "undefined" ? navigator : undefined;
	const conn =
		nav && "connection" in nav
			? (
					nav as unknown as {
						connection?: { effectiveType?: string };
					}
				).connection
			: undefined;

	enqueue([
		baseFields(config, "widget_render", {
			metadata: {
				viewport_width: window.innerWidth,
				viewport_height: window.innerHeight,
				device_pixel_ratio: window.devicePixelRatio ?? 1,
				touch_support: "ontouchstart" in window ? 1 : 0,
				connection_type: conn?.effectiveType ?? "unknown",
				timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
			},
		}),
	]);

	// ── widget_error ───────────────────────────────────────────────────
	const onError = (ev: ErrorEvent) => {
		enqueue([
			baseFields(config, "widget_error", {
				metadata: {
					error_message: ev.message,
					error_stack: (ev.error?.stack ?? "").slice(0, 1024),
					error_source: ev.filename ?? "unknown",
				},
			}),
		]);
	};
	window.addEventListener("error", onError);
	cleanups.push(() => window.removeEventListener("error", onError));

	const onUnhandled = (ev: PromiseRejectionEvent) => {
		const reason = ev.reason;
		const message = reason instanceof Error ? reason.message : String(reason);
		const stack =
			reason instanceof Error ? (reason.stack ?? "").slice(0, 1024) : "";
		enqueue([
			baseFields(config, "widget_error", {
				metadata: {
					error_message: message,
					error_stack: stack,
					error_source: "unhandledrejection",
				},
			}),
		]);
	};
	window.addEventListener("unhandledrejection", onUnhandled);
	cleanups.push(() =>
		window.removeEventListener("unhandledrejection", onUnhandled),
	);

	// ── widget_click ───────────────────────────────────────────────────
	const onClick = (ev: MouseEvent) => {
		const target = ev.target as HTMLElement | null;
		enqueue([
			baseFields(config, "widget_click", {
				metadata: {
					target_tag: target?.tagName?.toLowerCase() ?? "unknown",
					target_id: target?.id || undefined,
					target_class: target?.className || undefined,
					click_x: ev.clientX,
					click_y: ev.clientY,
				},
			}),
		]);
	};
	document.addEventListener("click", onClick, { capture: true });
	cleanups.push(() =>
		document.removeEventListener("click", onClick, { capture: true }),
	);

	// ── widget_link_click ──────────────────────────────────────────────
	const onLinkClick = (ev: MouseEvent) => {
		const anchor = (ev.target as HTMLElement)?.closest?.("a");
		if (!anchor) return;
		const href = anchor.getAttribute("href") ?? "";
		const isExternal =
			href.startsWith("http") && !href.startsWith(window.location.origin);
		enqueue([
			baseFields(config, "widget_link_click", {
				metadata: {
					href,
					link_text: (anchor.textContent ?? "").slice(0, 200),
					is_external: isExternal,
				},
			}),
		]);
	};
	document.addEventListener("click", onLinkClick, { capture: true });
	cleanups.push(() =>
		document.removeEventListener("click", onLinkClick, {
			capture: true,
		}),
	);

	// ── widget_scroll ──────────────────────────────────────────────────
	let scrollTimer: ReturnType<typeof setTimeout> | null = null;
	let lastScrollY = window.scrollY || 0;
	const onScroll = () => {
		if (scrollTimer) return;
		scrollTimer = setTimeout(() => {
			scrollTimer = null;
			const scrollTop = window.scrollY || document.documentElement.scrollTop;
			const docHeight =
				document.documentElement.scrollHeight -
				document.documentElement.clientHeight;
			const depthPct =
				docHeight > 0 ? Math.round((scrollTop / docHeight) * 100) : 0;
			const direction = scrollTop >= lastScrollY ? "down" : "up";
			lastScrollY = scrollTop;
			enqueue([
				baseFields(config, "widget_scroll", {
					metadata: {
						scroll_depth_pct: depthPct,
						scroll_direction: direction,
						viewport_height: window.innerHeight,
					},
				}),
			]);
		}, 250);
	};
	window.addEventListener("scroll", onScroll, { passive: true });
	cleanups.push(() => {
		window.removeEventListener("scroll", onScroll);
		if (scrollTimer) clearTimeout(scrollTimer);
	});

	// ── widget_form_field ──────────────────────────────────────────────
	const fieldTimers = new WeakMap<EventTarget, number>();

	const onFocusIn = (ev: FocusEvent) => {
		const target = ev.target as HTMLElement | null;
		if (!target || !isFormField(target)) return;
		fieldTimers.set(target, Date.now());
	};
	const onFocusOut = (ev: FocusEvent) => {
		const target = ev.target as HTMLElement | null;
		if (!target || !isFormField(target)) return;
		const start = fieldTimers.get(target);
		const timeInField = start ? Date.now() - start : 0;
		const input = target as HTMLInputElement;
		enqueue([
			baseFields(config, "widget_form_field", {
				metadata: {
					field_name: input.name || input.id || undefined,
					field_type: input.type || target.tagName.toLowerCase(),
					time_in_field_ms: timeInField,
					filled: !!input.value,
				},
			}),
		]);
	};
	document.addEventListener("focusin", onFocusIn, { capture: true });
	document.addEventListener("focusout", onFocusOut, { capture: true });
	cleanups.push(() => {
		document.removeEventListener("focusin", onFocusIn, { capture: true });
		document.removeEventListener("focusout", onFocusOut, { capture: true });
	});

	// ── widget_form_submit ─────────────────────────────────────────────
	const formStartTimes = new WeakMap<HTMLFormElement, number>();
	const trackFormStart = (ev: FocusEvent) => {
		const target = ev.target as HTMLElement | null;
		const form = target?.closest?.("form");
		if (form && !formStartTimes.has(form)) {
			formStartTimes.set(form, Date.now());
		}
	};
	document.addEventListener("focusin", trackFormStart, { capture: true });
	cleanups.push(() =>
		document.removeEventListener("focusin", trackFormStart, {
			capture: true,
		}),
	);

	const onSubmit = (ev: SubmitEvent) => {
		const form = ev.target as HTMLFormElement | null;
		const startTime = form ? formStartTimes.get(form) : undefined;

		let validationErrors = 0;
		if (form) {
			const fields = form.querySelectorAll("input, textarea, select");
			for (const field of fields) {
				const el = field as HTMLInputElement;
				if (el.validity && !el.validity.valid) {
					validationErrors++;
				} else if (el.getAttribute("aria-invalid") === "true") {
					validationErrors++;
				}
			}
		}

		enqueue([
			baseFields(config, "widget_form_submit", {
				metadata: {
					form_id: form?.id || undefined,
					time_to_submit_ms: startTime ? Date.now() - startTime : undefined,
					validation_errors: validationErrors,
				},
			}),
		]);
	};
	document.addEventListener("submit", onSubmit, { capture: true });
	cleanups.push(() =>
		document.removeEventListener("submit", onSubmit, { capture: true }),
	);

	return () => {
		for (const cleanup of cleanups) {
			cleanup();
		}
	};
}
