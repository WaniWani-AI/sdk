import type {
	ToolCalledProperties,
	TrackInput,
} from "../../../tracking/index.js";
import type { WaniWaniClient } from "../../../types.js";
import type { WidgetTokenCache } from "../widget-token.js";

type UnknownRecord = Record<string, unknown>;

export type WaniwaniTracker = Pick<
	WaniWaniClient,
	"flush" | "track" | "_config"
>;

const USER_LOCATION_KEY = "waniwani/userLocation";

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
): TrackInput {
	const toolType = resolveToolType(toolName, options.toolType);
	const meta = extractMeta(extra);

	return {
		event: "tool.called",
		properties: {
			name: toolName,
			type: toolType,
			...(timing ?? {}),
		},
		meta,
		metadata: {
			source: "withWaniwani",
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
	baseUrl: string,
	onError?: (error: Error) => void,
): Promise<void> {
	if (!isRecord(result)) {
		return;
	}

	if (!isRecord(result._meta)) {
		(result as UnknownRecord)._meta = {};
	}

	const meta = (result as UnknownRecord)._meta as UnknownRecord;
	const waniwaniConfig: UnknownRecord = {
		endpoint: `${baseUrl.replace(/\/$/, "")}/api/mcp/events/v2/batch`,
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

	meta.waniwani = waniwaniConfig;
}

export function injectUserLocation(result: unknown, extra: unknown): void {
	const requestMeta = extractMeta(extra);
	if (!requestMeta) {
		return;
	}

	const userLocation = requestMeta[USER_LOCATION_KEY];
	if (!userLocation) {
		return;
	}

	if (!isRecord(result)) {
		return;
	}

	if (!isRecord(result._meta)) {
		(result as UnknownRecord)._meta = {};
	}

	const resultMeta = (result as UnknownRecord)._meta as UnknownRecord;

	if (!resultMeta[USER_LOCATION_KEY]) {
		resultMeta[USER_LOCATION_KEY] = userLocation;
	}
}

function toError(error: unknown): Error {
	if (error instanceof Error) {
		return error;
	}
	return new Error(String(error));
}
