import {
	type AgentIntent,
	createIntentField,
	skipsIntentField,
} from "./agent-intent";

export type AgentSignal =
	| "webdriver"
	| "headless"
	| "automation_global"
	| "untrusted_input"
	| "click_without_motion"
	| "pointer_teleport"
	| "text_without_keys";

const AUTOMATION_GLOBALS = [
	"__playwright__binding__",
	"__pwInitScripts",
	"__nightmare",
	"_phantom",
	"callPhantom",
	"domAutomation",
	"domAutomationController",
	"__selenium_unwrapped",
	"__webdriver_evaluate",
	"__driver_evaluate",
	"__webdriver_script_fn",
	"__fxdriver_unwrapped",
];
// ChromeDriver leaves a `cdc_…` property on the window, and older versions a `$cdc_…` one on the document.
const CHROMEDRIVER_KEY = /^\$?cdc_/;
const HEADLESS_BRAND = /headless/i;
const TELEPORT_DISTANCE_PX = 100;
const TELEPORT_MAX_MOVES = 2;
const FIRST_SEND_DELAY_MS = 3000;
const MAX_SENDS = 3;
const MAX_INTENT_SENDS = 2;

type BrandedNavigator = Navigator & {
	userAgentData?: { brands?: { brand: string }[] };
};

export const readEnvironmentSignals = (input: {
	win: Window;
	doc: Document;
}): AgentSignal[] => {
	const { win, doc } = input;
	const nav: BrandedNavigator = win.navigator;
	const signals: AgentSignal[] = [];

	if (nav.webdriver === true) {
		signals.push("webdriver");
	}

	const brands = nav.userAgentData?.brands ?? [];
	if (
		HEADLESS_BRAND.test(nav.userAgent) ||
		brands.some((entry) => HEADLESS_BRAND.test(entry.brand))
	) {
		signals.push("headless");
	}

	const hasGlobal = AUTOMATION_GLOBALS.some((name) => name in win);
	const hasChromeDriverKey = [...Object.keys(win), ...Object.keys(doc)].some(
		(key) => CHROMEDRIVER_KEY.test(key),
	);
	if (hasGlobal || hasChromeDriverKey) {
		signals.push("automation_global");
	}

	return signals;
};

type Point = { x: number; y: number };

const touchPrimary = (): boolean =>
	typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;

/**
 * Input a person cannot make: script-dispatched events, a mouse click with no
 * motion, a pointer that jumps to its target, text typed into a field that
 * never got a key press.
 */
export const createInputWatcher = (
	target: EventTarget,
	onSignal: (signal: AgentSignal) => void = () => {},
) => {
	const signals = new Set<AgentSignal>();
	const keyedTargets = new WeakSet<EventTarget>();
	// Input masks and framework value setters dispatch untrusted input right after a person types.
	const typedTargets = new WeakSet<EventTarget>();
	let movesSinceDown = 0;
	let anchor: Point | null = null;
	let sawMotion = false;

	const add = (signal: AgentSignal) => {
		if (signals.has(signal)) {
			return;
		}
		signals.add(signal);
		onSignal(signal);
	};

	const onUntrusted = (event: Event) => {
		if (!event.isTrusted) {
			add("untrusted_input");
		}
	};

	const onKeyDown = (event: Event) => {
		onUntrusted(event);
		if (event.isTrusted && event.target) {
			keyedTargets.add(event.target);
			typedTargets.add(event.target);
		}
	};

	const onInput = (event: Event) => {
		if (!event.isTrusted) {
			if (!event.target || !typedTargets.has(event.target)) {
				add("untrusted_input");
			}
			return;
		}
		if (event.target) {
			typedTargets.add(event.target);
		}
		const inputType = Reflect.get(event, "inputType");
		if (
			inputType === "insertText" &&
			event.target &&
			!keyedTargets.has(event.target) &&
			!touchPrimary()
		) {
			add("text_without_keys");
		}
	};

	const onMove = (event: Event) => {
		if (!event.isTrusted || !(event instanceof MouseEvent)) {
			return;
		}
		sawMotion = true;
		movesSinceDown += 1;
		anchor ??= { x: event.clientX, y: event.clientY };
	};

	const onDown = (event: Event) => {
		onUntrusted(event);
		if (!event.isTrusted || !(event instanceof PointerEvent)) {
			return;
		}
		if (event.pointerType !== "mouse") {
			return;
		}

		if (!sawMotion) {
			add("click_without_motion");
		} else if (anchor && movesSinceDown <= TELEPORT_MAX_MOVES) {
			const distance = Math.hypot(
				event.clientX - anchor.x,
				event.clientY - anchor.y,
			);
			if (distance > TELEPORT_DISTANCE_PX) {
				add("pointer_teleport");
			}
		}

		movesSinceDown = 0;
		anchor = { x: event.clientX, y: event.clientY };
	};

	const options = { capture: true, passive: true };
	const untrustedEvents = ["mousemove", "wheel"];
	target.addEventListener("mousemove", onMove, options);
	target.addEventListener("pointerdown", onDown, options);
	target.addEventListener("keydown", onKeyDown, options);
	target.addEventListener("input", onInput, options);
	for (const name of untrustedEvents) {
		target.addEventListener(name, onUntrusted, options);
	}

	return {
		signals: (): AgentSignal[] => [...signals],
		stop: () => {
			target.removeEventListener("mousemove", onMove, options);
			target.removeEventListener("pointerdown", onDown, options);
			target.removeEventListener("keydown", onKeyDown, options);
			target.removeEventListener("input", onInput, options);
			for (const name of untrustedEvents) {
				target.removeEventListener(name, onUntrusted, options);
			}
		},
	};
};

export type AgentBeaconPayload = {
	v: 1;
	token: string;
	pageViewId: string;
	url: string;
	referrer: string | null;
	elapsedMs: number;
	signals: AgentSignal[];
	/** The agent's own answer to the intent field, sent only on a page that raised a signal. */
	intent?: string;
	/** Path of the form whose intent field held `intent`. */
	intentForm?: string | null;
};

const withoutQuery = (href: string): string | null => {
	try {
		const url = new URL(href);
		return `${url.origin}${url.pathname}`;
	} catch {
		return null;
	}
};

export const resolveBeaconEndpoint = (api: string, base: string): string =>
	`${new URL(api, base).origin}/api/v2/agent-traffic/beacon`;

const newPageViewId = (): string =>
	typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
		? crypto.randomUUID()
		: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

const send = (endpoint: string, payload: AgentBeaconPayload): void => {
	// A fetch can leave out credentials, where sendBeacon always sends cookies cross-origin.
	// text/plain keeps it a simple request, so no CORS preflight runs on unload.
	void fetch(endpoint, {
		method: "POST",
		body: JSON.stringify(payload),
		headers: { "Content-Type": "text/plain" },
		keepalive: true,
		mode: "no-cors",
		credentials: "omit",
	}).catch(() => {});
};

/**
 * One page view, one id. A page that shows automation at load reports at once,
 * otherwise the first report goes out a few seconds after load if a signal
 * fired, and the page reports again on hide only when it saw more. Once any
 * signal fires, every form gets its optional intent field, unless the user
 * agent names a crawler, and an answer is reported as soon as its form is
 * submitted.
 */
export const startAgentBeacon = (input: {
	api: string;
	token: string;
}): { stop: () => void } => {
	const endpoint = resolveBeaconEndpoint(input.api, location.href);
	const url = withoutQuery(location.href);
	if (!url) {
		return { stop: () => {} };
	}

	const referrer = document.referrer ? withoutQuery(document.referrer) : null;
	const environment = readEnvironmentSignals({ win: window, doc: document });
	const pageViewId = newPageViewId();
	let sentCount = 0;
	let sentSignals = 0;
	let intentSends = 0;

	const currentSignals = (): AgentSignal[] => [
		...new Set([...environment, ...watcher.signals()]),
	];

	const post = (signals: AgentSignal[], intent?: AgentIntent) => {
		send(endpoint, {
			v: 1,
			token: input.token,
			pageViewId,
			url,
			referrer,
			elapsedMs: Math.round(performance.now()),
			signals,
			...(intent ? { intent: intent.text, intentForm: intent.form } : {}),
		});
	};

	const report = () => {
		const signals = currentSignals();
		if (signals.length === 0 || signals.length === sentSignals) {
			return;
		}
		if (sentCount >= MAX_SENDS) {
			return;
		}
		sentCount += 1;
		sentSignals = signals.length;
		post(signals);
	};

	const intentField = skipsIntentField(navigator.userAgent)
		? null
		: createIntentField({
				win: window,
				doc: document,
				onIntent: (intent) => {
					const signals = currentSignals();
					if (signals.length === 0 || intentSends >= MAX_INTENT_SENDS) {
						return false;
					}
					intentSends += 1;
					sentSignals = signals.length;
					post(signals, intent);
					return true;
				},
			});
	const watcher = createInputWatcher(window, () => intentField?.reveal());

	const onHide = () => {
		if (document.visibilityState === "hidden") {
			report();
		}
	};

	if (environment.length > 0) {
		intentField?.reveal();
		report();
	}
	const timer = setTimeout(report, FIRST_SEND_DELAY_MS);
	document.addEventListener("visibilitychange", onHide);
	window.addEventListener("pagehide", report);

	return {
		stop: () => {
			clearTimeout(timer);
			watcher.stop();
			intentField?.stop();
			document.removeEventListener("visibilitychange", onHide);
			window.removeEventListener("pagehide", report);
		},
	};
};
