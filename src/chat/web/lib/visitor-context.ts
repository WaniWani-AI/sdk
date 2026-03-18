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
// Visitor ID (property-based hash, persisted in localStorage)
// ============================================================================

async function sha256(input: string): Promise<string> {
	const data = new TextEncoder().encode(input);
	const hash = await crypto.subtle.digest("SHA-256", data);
	return Array.from(new Uint8Array(hash))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

async function computeVisitorId(): Promise<string> {
	// Try localStorage first
	try {
		const stored = localStorage.getItem(VISITOR_ID_KEY);
		if (stored) {
			return stored;
		}
	} catch {
		// localStorage unavailable (private browsing, security policy)
	}

	const raw = [
		navigator.userAgent,
		screen.width,
		screen.height,
		screen.colorDepth,
		Intl.DateTimeFormat().resolvedOptions().timeZone,
		navigator.language,
		navigator.hardwareConcurrency ?? "",
		navigator.platform ?? "",
	].join("|");

	const id = await sha256(raw);

	try {
		localStorage.setItem(VISITOR_ID_KEY, id);
	} catch {
		// Ignore storage failures
	}

	return id;
}

// ============================================================================
// Main export
// ============================================================================

export async function collectVisitorContext(): Promise<VisitorContext> {
	const ua = navigator.userAgent;
	const visitorId = await computeVisitorId();

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
	};
}
