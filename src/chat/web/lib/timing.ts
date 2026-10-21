import { bundleExecuted, secondSdkOnPage } from "../embed/boot-clock";
import type { WidgetMode } from "../embed/widget-events";
import { buildApiUrl } from "./api-url";
import { debugLog } from "./debug";
import { getOrCreateVisitorId } from "./visitor-context";

// Replaced at build time by tsup (`define` in tsup.config.ts); the fallback
// covers tests and any bundle that doesn't define it.
declare const __WANIWANI_SDK_VERSION__: string;
const SDK_VERSION =
	typeof __WANIWANI_SDK_VERSION__ === "string"
		? __WANIWANI_SDK_VERSION__
		: "0.0.0";

const MAX_METRICS = 40;
const MAX_TAGS = 10;
const MAX_METRIC_MS = 600_000;

export type TimingKind = "boot" | "turn" | "widget";
export type TimingOutcome = "ok" | "timeout" | "error";
export type TimingTags = Record<string, string | boolean | undefined>;

export interface TimingTarget {
	api?: string;
	token?: string;
	channelId?: string;
	sessionId?: string;
}

function now(): number {
	return typeof performance === "undefined" ? 0 : performance.now();
}

export interface TimingRecorder {
	readonly metrics: Record<string, number>;
	/** First write wins, so a repeated event keeps the moment it first happened. */
	mark(name: string, at?: number): void;
	has(name: string): boolean;
	set(name: string, value: number): void;
}

export function createRecorder(
	kind: TimingKind,
	origin: number,
): TimingRecorder {
	const metrics: Record<string, number> = {};
	return {
		metrics,
		has: (name) => name in metrics,
		set(name, value) {
			metrics[name] = value;
		},
		mark(name, at = now()) {
			if (name in metrics) {
				return;
			}
			metrics[name] = at - origin;
			try {
				performance.mark(`waniwani:${kind}:${name}`, { startTime: at });
			} catch {
				// Old engines reject the options argument.
			}
		},
	};
}

function cleanMetrics(raw: Record<string, number>): Record<string, number> {
	const out: Record<string, number> = {};
	for (const [key, value] of Object.entries(raw)) {
		if (Object.keys(out).length >= MAX_METRICS) {
			break;
		}
		if (!Number.isFinite(value)) {
			continue;
		}
		const ms = Math.round(value);
		if (ms < 0 || ms > MAX_METRIC_MS) {
			continue;
		}
		out[key] = ms;
	}
	return out;
}

function cleanTags(raw: TimingTags): Record<string, string | boolean> {
	const out: Record<string, string | boolean> = {};
	for (const [key, value] of Object.entries(raw)) {
		if (Object.keys(out).length >= MAX_TAGS) {
			break;
		}
		if (typeof value === "string" || typeof value === "boolean") {
			out[key] = value;
		}
	}
	return out;
}

interface NetworkInformation {
	effectiveType?: string;
	rtt?: number;
	downlink?: number;
	saveData?: boolean;
}

function connection(): NetworkInformation | undefined {
	const net = (navigator as { connection?: NetworkInformation }).connection;
	if (!net) {
		return undefined;
	}
	return {
		effectiveType: net.effectiveType,
		rtt: net.rtt,
		downlink: net.downlink,
		saveData: net.saveData,
	};
}

/** The `Authorization` header's bearer value, which is the public token on every hosted surface. */
export function bearerToken(
	headers: Record<string, string> | undefined,
): string | undefined {
	const value = headers?.Authorization;
	return typeof value === "string" && value.startsWith("Bearer ")
		? value.slice(7)
		: undefined;
}

export function buildTimingPayload(
	kind: TimingKind,
	target: TimingTarget,
	tags: TimingTags,
	metrics: Record<string, number>,
): Record<string, unknown> {
	return {
		kind,
		sdkVersion: SDK_VERSION,
		channelId: target.channelId || undefined,
		sessionId: kind === "boot" ? undefined : target.sessionId || undefined,
		visitorId: getOrCreateVisitorId(),
		pageHost: window.location.hostname,
		connection: connection(),
		tags: cleanTags(tags),
		metrics: cleanMetrics(metrics),
	};
}

/** Undecided until a channel config answers; beacons wait in `pending` until then. */
let beacons: boolean | undefined;
let pending: Array<() => void> = [];

/** The channel opts in with custom metadata `chatTimingLogs: true`. On flushes the held beacons, off drops them. */
export function setTimingMetadata(
	metadata: Record<string, string> | null | undefined,
): void {
	const enabled =
		String(metadata?.chatTimingLogs).trim().toLowerCase() === "true";
	beacons = enabled;
	const held = pending;
	pending = [];
	if (enabled) {
		for (const send of held) {
			send();
		}
	}
}

export function sendTiming(
	kind: TimingKind,
	target: TimingTarget,
	tags: TimingTags,
	metrics: Record<string, number>,
): void {
	const { api, token } = target;
	if (typeof window === "undefined" || !api || !token || beacons === false) {
		return;
	}
	try {
		const payload = buildTimingPayload(kind, target, tags, metrics);
		const send = () => {
			debugLog("timing", payload);
			void fetch(buildApiUrl(api, "/timing"), {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${token}`,
				},
				body: JSON.stringify(payload),
				keepalive: true,
			}).catch(() => {});
		};
		if (beacons) {
			send();
		} else if (pending.length < 20) {
			pending.push(send);
		}
	} catch {
		// Telemetry never reaches the host page.
	}
}

/** Boot metrics are page-level, and their zero is `performance.timeOrigin`. */
let boot = createRecorder("boot", 0);
let configSource: string | undefined;

/** Test-only: drop the page-level boot marks and the beacon verdict. */
export function __resetBootTiming(): void {
	boot = createRecorder("boot", 0);
	configSource = undefined;
	beacons = undefined;
	pending = [];
}

export function markBoot(name: string, at?: number): void {
	boot.mark(name, at);
}

/** First write wins: the source that made the surface ready is the one worth reporting. */
export function markConfigSource(source: "cache" | "remote" | "timeout"): void {
	configSource ??= source;
}

const BUNDLE_URL =
	/cdn\.jsdelivr\.net\/npm\/@waniwani\/sdk@[^/]+\/dist\/chat\/embed\.js/;
const LOADER_URL = /\/embed\.js(\?|$)/;

function harvestResourceTiming(): void {
	if (typeof performance === "undefined") {
		return;
	}
	const nav = performance.getEntriesByType("navigation")[0] as
		| PerformanceNavigationTiming
		| undefined;
	if (nav?.responseStart) {
		boot.mark("navTtfb", nav.responseStart);
	}
	if (nav?.domContentLoadedEventEnd) {
		boot.mark("navDomContentLoaded", nav.domContentLoadedEventEnd);
	}
	const resources = performance.getEntriesByType(
		"resource",
	) as PerformanceResourceTiming[];
	for (const entry of resources) {
		if (BUNDLE_URL.test(entry.name)) {
			boot.mark("bundleStart", entry.startTime);
			boot.mark("bundleEnd", entry.responseEnd);
		} else if (LOADER_URL.test(entry.name)) {
			boot.mark("loaderStart", entry.startTime);
			boot.mark("loaderEnd", entry.responseEnd);
		}
	}
}

function secondSdk(): boolean {
	if (secondSdkOnPage) {
		return true;
	}
	try {
		return document.querySelectorAll('script[src*="@waniwani/sdk"]').length > 1;
	} catch {
		return false;
	}
}

export interface BootTimingReport extends TimingTarget {
	mode: WidgetMode;
}

export function reportBoot(report: BootTimingReport): void {
	harvestResourceTiming();
	boot.mark("bundleExecuted", bundleExecuted);
	sendTiming(
		"boot",
		report,
		{ configSource, mode: report.mode, secondSdk: secondSdk() },
		boot.metrics,
	);
}

const CHUNK_MARKS: Array<[needle: string, mark: string]> = [
	["text-delta", "firstText"],
	["tool-input-start", "firstToolInput"],
	["tool-output-available", "firstToolOutput"],
];

export interface TurnTimer {
	mark(name: string): void;
	/** Tees the response body so chunk arrivals are stamped without re-parsing the UI message protocol. */
	instrument(response: Response): Response;
	report(target: TimingTarget, tags: TimingTags): void;
}

/** A turn's zero is the moment the visitor submits. */
export function startTurn(turnIndex: number): TurnTimer {
	const recorder = createRecorder("turn", now());
	recorder.set("turnIndex", turnIndex);
	let reported = false;
	return {
		mark: (name) => recorder.mark(name),
		instrument(response) {
			if (
				!response.ok ||
				!response.body ||
				typeof TransformStream === "undefined"
			) {
				return response;
			}
			try {
				const decoder = new TextDecoder();
				const stream = response.body.pipeThrough(
					new TransformStream<Uint8Array, Uint8Array>({
						transform(chunk, controller) {
							recorder.mark("firstChunk");
							const text = decoder.decode(chunk, { stream: true });
							for (const [needle, name] of CHUNK_MARKS) {
								if (!recorder.has(name) && text.includes(needle)) {
									recorder.mark(name);
								}
							}
							controller.enqueue(chunk);
						},
					}),
				);
				return new Response(stream, {
					status: response.status,
					statusText: response.statusText,
					headers: response.headers,
				});
			} catch {
				return response;
			}
		},
		report(target, tags) {
			if (reported) {
				return;
			}
			reported = true;
			sendTiming("turn", target, tags, recorder.metrics);
		},
	};
}

export interface WidgetTimingReport {
	widget: string;
	outcome: TimingOutcome;
	metrics: Record<string, number>;
}

export type WidgetTimingSink = (report: WidgetTimingReport) => void;

export interface WidgetTimer {
	mark(name: string): void;
	has(name: string): boolean;
	report(outcome: TimingOutcome, retries: number): void;
}

function stripQuery(uri: string): string {
	const query = uri.indexOf("?");
	return query === -1 ? uri : uri.slice(0, query);
}

/** A widget's zero is the frame's mount effect. */
export function startWidget(
	resourceUri: string,
	sink: WidgetTimingSink,
): WidgetTimer {
	const recorder = createRecorder("widget", now());
	let reported = false;
	return {
		mark: (name) => recorder.mark(name),
		has: (name) => recorder.has(name),
		report(outcome, retries) {
			if (reported) {
				return;
			}
			reported = true;
			recorder.set("retries", retries);
			sink({
				widget: stripQuery(resourceUri),
				outcome,
				metrics: recorder.metrics,
			});
		},
	};
}
