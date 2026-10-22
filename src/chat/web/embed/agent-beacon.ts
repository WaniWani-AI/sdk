export type AgentSignal =
	| "webdriver"
	| "headless"
	| "automation_global"
	| "untrusted_input"
	| "click_without_motion"
	| "pointer_teleport";

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
// ChromeDriver leaves a `cdc_…` property on the document.
const CHROMEDRIVER_KEY = /^\$?cdc_/;
const HEADLESS_BRAND = /headless/i;
const TELEPORT_DISTANCE_PX = 100;
const TELEPORT_MAX_MOVES = 2;
const FIRST_SEND_DELAY_MS = 3000;
const MAX_SENDS = 3;

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
	const hasChromeDriverKey = Object.keys(doc).some((key) =>
		CHROMEDRIVER_KEY.test(key),
	);
	if (hasGlobal || hasChromeDriverKey) {
		signals.push("automation_global");
	}

	return signals;
};

type Point = { x: number; y: number };

/** Input a person cannot make: script-dispatched events, a mouse click with no motion, a pointer that jumps to its target. */
export const createInputWatcher = (target: EventTarget) => {
	const signals = new Set<AgentSignal>();
	let movesSinceDown = 0;
	let anchor: Point | null = null;
	let sawMotion = false;

	const onUntrusted = (event: Event) => {
		if (!event.isTrusted) {
			signals.add("untrusted_input");
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
			signals.add("click_without_motion");
		} else if (anchor && movesSinceDown <= TELEPORT_MAX_MOVES) {
			const distance = Math.hypot(
				event.clientX - anchor.x,
				event.clientY - anchor.y,
			);
			if (distance > TELEPORT_DISTANCE_PX) {
				signals.add("pointer_teleport");
			}
		}

		movesSinceDown = 0;
		anchor = { x: event.clientX, y: event.clientY };
	};

	const options = { capture: true, passive: true };
	const untrustedEvents = ["mousemove", "keydown", "wheel"];
	target.addEventListener("mousemove", onMove, options);
	target.addEventListener("pointerdown", onDown, options);
	for (const name of untrustedEvents) {
		target.addEventListener(name, onUntrusted, options);
	}

	return {
		signals: (): AgentSignal[] => [...signals],
		stop: () => {
			target.removeEventListener("mousemove", onMove, options);
			target.removeEventListener("pointerdown", onDown, options);
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
 * One page view, one id. The first report goes out a few seconds after load if
 * a signal fired, and the page reports again on hide only when it saw more.
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
	const watcher = createInputWatcher(window);
	const pageViewId = newPageViewId();
	let sentCount = 0;
	let sentSignals = 0;

	const report = () => {
		const signals = [...new Set([...environment, ...watcher.signals()])];
		if (signals.length === 0 || signals.length === sentSignals) {
			return;
		}
		if (sentCount >= MAX_SENDS) {
			return;
		}
		sentCount += 1;
		sentSignals = signals.length;
		send(endpoint, {
			v: 1,
			token: input.token,
			pageViewId,
			url,
			referrer,
			elapsedMs: Math.round(performance.now()),
			signals,
		});
	};

	const onHide = () => {
		if (document.visibilityState === "hidden") {
			report();
		}
	};

	const timer = setTimeout(report, FIRST_SEND_DELAY_MS);
	document.addEventListener("visibilitychange", onHide);
	window.addEventListener("pagehide", report);

	return {
		stop: () => {
			clearTimeout(timer);
			watcher.stop();
			document.removeEventListener("visibilitychange", onHide);
			window.removeEventListener("pagehide", report);
		},
	};
};
