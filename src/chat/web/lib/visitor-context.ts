import { getOrCreateMemoryUserId } from "./memory-user-id";

const VISITOR_ID_KEY = "waniwani-visitor-id";

// ============================================================================
// Types
// ============================================================================

export interface VisitorContext {
	userAgent: string;
	browser: { name: string; version: string } | null;
	os: { name: string; version: string } | null;
	deviceType: "mobile" | "tablet" | "desktop";
	language: string;
	languages: string[];
	timezone: string;
	screenWidth: number;
	screenHeight: number;
	viewportWidth: number;
	viewportHeight: number;
	colorDepth: number;
	devicePixelRatio: number;
	touchSupport: boolean;
	connectionType: string;
	referrer: string;
	visitorId: string;
	memoryUserId: string;
}

// ============================================================================
// UA Parsing
// ============================================================================

function match(ua: string, pattern: RegExp): string | null {
	const m = ua.match(pattern);
	return m?.[1] ?? null;
}

export function parseBrowser(
	ua: string,
): { name: string; version: string } | null {
	// Order matters — Edge/Opera contain "Chrome", so check them first
	const browsers: [string, RegExp][] = [
		["Edge", /Edg(?:e|A|iOS)?\/(\S+)/],
		["Opera", /(?:OPR|Opera)\/(\S+)/],
		["Samsung Internet", /SamsungBrowser\/(\S+)/],
		["Firefox", /Firefox\/(\S+)/],
		["Chrome", /Chrome\/(\S+)/],
		["Safari", /Version\/(\S+).*Safari/],
	];

	for (const [name, pattern] of browsers) {
		const version = match(ua, pattern);
		if (version) {
			return { name, version };
		}
	}
	return null;
}

export function parseOS(ua: string): { name: string; version: string } | null {
	const systems: [string, RegExp][] = [
		["iOS", /(?:iPhone|iPad|iPod).+?OS (\d+[_.\d]*)/],
		["Android", /Android (\d+[.\d]*)/],
		["macOS", /Mac OS X (\d+[_.\d]*)/],
		["Windows", /Windows NT (\d+[.\d]*)/],
		["ChromeOS", /CrOS \S+ (\d+[.\d]*)/],
		["Linux", /Linux/],
	];

	for (const [name, pattern] of systems) {
		const version = match(ua, pattern);
		if (version) {
			return { name, version: version.replace(/_/g, ".") };
		}
		if (name === "Linux" && pattern.test(ua)) {
			return { name, version: "" };
		}
	}
	return null;
}

export function detectDeviceType(ua: string): "mobile" | "tablet" | "desktop" {
	// Use UA-CH if available
	if (
		typeof navigator !== "undefined" &&
		"userAgentData" in navigator &&
		// biome-ignore lint/suspicious/noExplicitAny: userAgentData is not typed
		(navigator as any).userAgentData?.mobile
	) {
		return "mobile";
	}

	if (/iPad|tablet|PlayBook/i.test(ua)) {
		return "tablet";
	}
	if (/Mobi|Android.*Mobile|iPhone|iPod/i.test(ua)) {
		return "mobile";
	}
	return "desktop";
}

// ============================================================================
// Visitor ID (opaque id, persisted in localStorage)
// ============================================================================

/**
 * A random opaque id, generated synchronously. Prefers `crypto.randomUUID`
 * and falls back to a `crypto.getRandomValues` UUIDv4 when it is missing
 * (older browsers), and finally to a non-crypto random string when the Web
 * Crypto API is entirely unavailable (e.g. a non-secure context). The value
 * is opaque, so any of these is a valid visitor id.
 */
function randomId(): string {
	try {
		if (typeof crypto !== "undefined") {
			if (typeof crypto.randomUUID === "function") {
				return crypto.randomUUID();
			}
			if (typeof crypto.getRandomValues === "function") {
				const bytes = crypto.getRandomValues(new Uint8Array(16));
				// RFC 4122 v4 layout
				bytes[6] = (bytes[6] & 0x0f) | 0x40;
				bytes[8] = (bytes[8] & 0x3f) | 0x80;
				const hex = Array.from(bytes, (b) =>
					b.toString(16).padStart(2, "0"),
				).join("");
				return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
			}
		}
	} catch {
		// Fall through to the non-crypto path below.
	}
	return `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Synchronously return a stable, persisted visitor id, creating one on first
 * call. Runs with no async work and no `crypto.subtle` dependency, so it never
 * races an in-flight promise and never fails on a non-secure context — callers
 * can rely on a visitor id being present on the very first event or request.
 */
export function getOrCreateVisitorId(): string {
	try {
		const stored = localStorage.getItem(VISITOR_ID_KEY);
		if (stored) {
			return stored;
		}
	} catch {
		// localStorage unavailable (private browsing, security policy) — fall
		// through and mint a fresh id. It won't persist, but the request/event
		// still carries a visitor id for this page load.
	}

	const id = randomId();

	try {
		localStorage.setItem(VISITOR_ID_KEY, id);
	} catch {
		// Ignore storage failures.
	}

	return id;
}

// ============================================================================
// Main export
// ============================================================================

export async function collectVisitorContext(): Promise<VisitorContext> {
	const ua = navigator.userAgent;
	const visitorId = getOrCreateVisitorId();
	const memoryUserId = await getOrCreateMemoryUserId();

	return {
		userAgent: ua,
		browser: parseBrowser(ua),
		os: parseOS(ua),
		deviceType: detectDeviceType(ua),
		language: navigator.language,
		languages: [...navigator.languages],
		timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
		screenWidth: screen.width,
		screenHeight: screen.height,
		viewportWidth: window.innerWidth,
		viewportHeight: window.innerHeight,
		colorDepth: screen.colorDepth,
		devicePixelRatio: window.devicePixelRatio ?? 1,
		touchSupport: "ontouchstart" in window || navigator.maxTouchPoints > 0,
		// biome-ignore lint/suspicious/noExplicitAny: navigator.connection is not typed
		connectionType: (navigator as any).connection?.effectiveType ?? "unknown",
		referrer: document.referrer,
		visitorId,
		memoryUserId,
	};
}
