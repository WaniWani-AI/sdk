import { getOrCreateVisitorId } from "../../../shared/visitor-id";
import { getOrCreateMemoryUserId } from "./memory-user-id";

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

export {
	applyVisitorId,
	getOrCreateVisitorId,
	setVisitorId,
	type VisitorIdInput,
} from "../../../shared/visitor-id";

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
