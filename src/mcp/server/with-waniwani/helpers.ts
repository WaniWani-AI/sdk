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
const OPENAI_USER_LOCATION_KEY = "openai/userLocation";

const LOCATION_META_KEYS = [
	OPENAI_USER_LOCATION_KEY,
	GEO_LOCATION_KEY,
	LEGACY_USER_LOCATION_KEY,
] as const;

const COORDINATE_KEYS = ["latitude", "longitude"] as const;

export function stripGeoCoordinatesFromMeta(
	meta: UnknownRecord,
): UnknownRecord {
	let next: UnknownRecord | undefined;
	for (const key of LOCATION_META_KEYS) {
		const value = meta[key];
		if (!isRecord(value)) {
			continue;
		}
		let stripped: UnknownRecord | undefined;
		for (const coord of COORDINATE_KEYS) {
			if (coord in value) {
				if (!stripped) {
					stripped = { ...value };
				}
				delete stripped[coord];
			}
		}
		if (stripped) {
			if (!next) {
				next = { ...meta };
			}
			next[key] = stripped;
		}
	}
	return next ?? meta;
}

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
		stripGeoCoordinates?: boolean;
		redactInput?: (input: unknown) => unknown;
	},
	timing?: { durationMs: number; status: string; errorMessage?: string },
	clientInfo?: { name: string; version: string },
	io?: { input?: unknown; output?: unknown },
): TrackInput {
	const toolType = resolveToolType(toolName, options.toolType);

	const rawMeta = extractMeta(extra);
	const meta =
		rawMeta && options.stripGeoCoordinates
			? stripGeoCoordinatesFromMeta(rawMeta)
			: rawMeta;

	const input =
		io?.input !== undefined && options.redactInput
			? options.redactInput(io.input)
			: io?.input;

	const output =
		options.stripGeoCoordinates &&
		isRecord(io?.output) &&
		isRecord(io.output._meta)
			? {
					...(io.output as UnknownRecord),
					_meta: stripGeoCoordinatesFromMeta(io.output._meta as UnknownRecord),
				}
			: io?.output;

	return {
		event: "tool.called",
		properties: {
			name: toolName,
			type: toolType,
			...(timing ?? {}),
			...(input !== undefined && { input }),
			...(output !== undefined && { output }),
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

/**
 * Widget-related keys from a tool's **definition** `_meta` that the chat UI
 * and MCP hosts look for on tool call **results**. The MCP protocol exposes
 * these in `tools/list`, but chat clients that stream results via AI SDK
 * proxies (e.g. `@ai-sdk/mcp`) don't forward definition metadata to the
 * UI layer — the chat UI only sees the result's `_meta`.
 *
 * Forwarding these keys into every tool result makes widgets registered via
 * any MCP framework (skybridge, raw `@modelcontextprotocol/sdk`, etc.) render
 * in WaniWani chat without the handler having to set them manually.
 *
 * Keys:
 * - `openai/outputTemplate` — OpenAI Apps SDK widget URI (ChatGPT).
 * - `ui/resourceUri` — MCP Apps extension flat-key form (Claude, per spec).
 * - `ui` — MCP Apps extension nested form `{ resourceUri, autoHeight, ... }`.
 * - `openai/widgetAccessible`, `openai/resultCanProduceWidget`,
 *   `openai/toolInvocation/invoking`, `openai/toolInvocation/invoked` —
 *   additional OpenAI metadata widgets depend on.
 */
const WIDGET_META_KEYS = [
	"openai/outputTemplate",
	"openai/widgetAccessible",
	"openai/resultCanProduceWidget",
	"openai/toolInvocation/invoking",
	"openai/toolInvocation/invoked",
	"ui/resourceUri",
	"ui",
] as const;

export function injectWidgetDefinitionMeta(
	result: unknown,
	definitionMeta: UnknownRecord | undefined,
): void {
	if (!definitionMeta || !isRecord(result)) {
		return;
	}

	let hasAnyKey = false;
	for (const key of WIDGET_META_KEYS) {
		if (key in definitionMeta) {
			hasAnyKey = true;
			break;
		}
	}
	if (!hasAnyKey) {
		return;
	}

	if (!isRecord(result._meta)) {
		(result as UnknownRecord)._meta = {};
	}
	const resultMeta = (result as UnknownRecord)._meta as UnknownRecord;

	for (const key of WIDGET_META_KEYS) {
		if (!(key in definitionMeta)) {
			continue;
		}
		// Handler-set values win: never overwrite something the tool returned.
		if (key in resultMeta) {
			continue;
		}
		resultMeta[key] = definitionMeta[key];
	}
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
