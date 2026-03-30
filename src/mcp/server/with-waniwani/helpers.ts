import type {
	ToolCalledProperties,
	TrackInput,
} from "../../../tracking/index.js";
import type { WaniWaniClient } from "../../../types.js";
import { extractSessionId, extractSource } from "../utils.js";
import type { WidgetTokenCache } from "../widget-token.js";

type UnknownRecord = Record<string, unknown>;

export type WaniwaniTracker = Pick<
	WaniWaniClient,
	"flush" | "track" | "identify" | "kb" | "_config"
>;

const SESSION_ID_KEY = "waniwani/sessionId";
const GEO_LOCATION_KEY = "waniwani/geoLocation";
const LEGACY_USER_LOCATION_KEY = "waniwani/userLocation";

export function isRecord(value: unknown): value is UnknownRecord {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function extractMeta(extra: unknown): UnknownRecord | undefined {
	if (!isRecord(extra)) {
		return undefined;
	}
	const meta = extra._meta;
	return isRecord(meta) ? meta : undefined;
}

export function extractErrorText(result: unknown): string | undefined {
	if (!isRecord(result)) {
		return undefined;
	}
	const content = (result as UnknownRecord).content;
	if (!Array.isArray(content)) {
		return undefined;
	}
	const textPart = content.find(
		(c: unknown) =>
			isRecord(c) && c.type === "text" && typeof c.text === "string",
	) as UnknownRecord | undefined;
	return textPart?.text as string | undefined;
}

export function resolveToolType(
	toolName: string,
	toolTypeOption:
		| ToolCalledProperties["type"]
		| ((toolName: string) => ToolCalledProperties["type"] | undefined)
		| undefined,
): ToolCalledProperties["type"] {
	if (typeof toolTypeOption === "function") {
		return toolTypeOption(toolName) ?? "other";
	}
	return toolTypeOption ?? "other";
}

export function buildTrackInput(
	toolName: string,
	extra: unknown,
	options: {
		toolType?: typeof resolveToolType extends (n: string, o: infer T) => unknown
			? T
			: never;
		metadata?: UnknownRecord;
	},
	timing?: { durationMs: number; status: string; errorMessage?: string },
	clientInfo?: { name: string; version: string },
	io?: { input?: unknown; output?: unknown },
): TrackInput {
	const toolType = resolveToolType(toolName, options.toolType);
	const meta = extractMeta(extra);
	console.log(
		"[waniwani:debug] buildTrackInput meta:",
		JSON.stringify(meta),
		"-> source:",
		extractSource(meta),
	);

	return {
		event: "tool.called",
		properties: {
			name: toolName,
			type: toolType,
			...(timing ?? {}),
			...(io?.input !== undefined && { input: io.input }),
			...(io?.output !== undefined && { output: io.output }),
		},
		meta,
		source: extractSource(meta),
		metadata: {
			...(options.metadata ?? {}),
			...(clientInfo && { clientInfo }),
		},
	};
}

export async function safeTrack(
	tracker: Pick<WaniWaniClient, "track">,
	input: TrackInput,
	onError?: (error: Error) => void,
): Promise<void> {
	try {
		await tracker.track(input);
	} catch (error) {
		onError?.(toError(error));
	}
}

export async function safeFlush(
	tracker: Pick<WaniWaniClient, "flush">,
	onError?: (error: Error) => void,
): Promise<void> {
	try {
		await tracker.flush();
	} catch (error) {
		onError?.(toError(error));
	}
}

export async function injectWidgetConfig(
	result: unknown,
	cache: WidgetTokenCache | null,
	apiUrl: string,
	extra?: unknown,
	onError?: (error: Error) => void,
): Promise<void> {
	if (!isRecord(result)) {
		return;
	}

	if (!isRecord(result._meta)) {
		(result as UnknownRecord)._meta = {};
	}

	const meta = (result as UnknownRecord)._meta as UnknownRecord;
	const existingWaniwaniConfig = isRecord(meta.waniwani)
		? (meta.waniwani as UnknownRecord)
		: undefined;
	const waniwaniConfig: UnknownRecord = {
		...(existingWaniwaniConfig ?? {}),
		endpoint:
			existingWaniwaniConfig?.endpoint ??
			`${apiUrl.replace(/\/$/, "")}/api/mcp/events/v2/batch`,
	};

	if (cache) {
		try {
			const token = await cache.getToken();
			if (token) {
				waniwaniConfig.token = token;
			}
		} catch (error) {
			onError?.(toError(error));
		}
	}

	const sessionId = extractSessionId(meta);
	if (sessionId) {
		if (!waniwaniConfig.sessionId) {
			waniwaniConfig.sessionId = sessionId;
		}
	}

	const geoLocation = extractGeoLocation(meta);
	if (geoLocation !== undefined) {
		if (!waniwaniConfig.geoLocation) {
			waniwaniConfig.geoLocation = geoLocation;
		}
	}

	const source = extractSource(extractMeta(extra));
	if (source && !waniwaniConfig.source) {
		waniwaniConfig.source = source;
	}

	meta.waniwani = waniwaniConfig;
}

export function injectRequestMetadata(result: unknown, extra: unknown): void {
	const requestMeta = extractMeta(extra);
	if (!requestMeta) {
		return;
	}

	if (!isRecord(result)) {
		return;
	}

	if (!isRecord(result._meta)) {
		(result as UnknownRecord)._meta = {};
	}

	const resultMeta = (result as UnknownRecord)._meta as UnknownRecord;
	const sessionId = extractSessionId(requestMeta);
	if (sessionId && !resultMeta[SESSION_ID_KEY]) {
		resultMeta[SESSION_ID_KEY] = sessionId;
	}

	const geoLocation = extractGeoLocation(requestMeta);
	if (!geoLocation) {
		return;
	}

	if (!resultMeta[GEO_LOCATION_KEY]) {
		resultMeta[GEO_LOCATION_KEY] = geoLocation;
	}

	if (!resultMeta[LEGACY_USER_LOCATION_KEY]) {
		resultMeta[LEGACY_USER_LOCATION_KEY] = geoLocation;
	}
}

function extractGeoLocation(
	meta: UnknownRecord | undefined,
): UnknownRecord | string | undefined {
	if (!meta) {
		return undefined;
	}

	const geoLocation = meta[GEO_LOCATION_KEY] ?? meta[LEGACY_USER_LOCATION_KEY];
	if (isRecord(geoLocation) || typeof geoLocation === "string") {
		return geoLocation;
	}

	return undefined;
}

function toError(error: unknown): Error {
	if (error instanceof Error) {
		return error;
	}
	return new Error(String(error));
}
