import { z } from "zod";
import type { SessionErrorProperties } from "../../../tracking/@types.js";

// Providers and HTTP clients disagree on which key carries the status, so read
// both. Zod rather than a cast: the input is genuinely `unknown`.
const statusCarrierSchema = z.object({
	status: z.number().optional(),
	statusCode: z.number().optional(),
});

function readStatus(error: unknown): number | undefined {
	const parsed = statusCarrierSchema.safeParse(error);
	if (!parsed.success) {
		return undefined;
	}
	return parsed.data.status ?? parsed.data.statusCode;
}

export function classifyCause({
	error,
}: {
	error: unknown;
}): SessionErrorProperties["cause"] {
	if (error instanceof z.ZodError) {
		return "invalid_output";
	}

	if (
		error instanceof Error &&
		(error.name === "AbortError" || error.name === "TimeoutError")
	) {
		return "timeout";
	}

	const status = readStatus(error);
	if (status === 429) {
		return "rate_limited";
	}
	if (status !== undefined && status >= 500) {
		return "upstream_5xx";
	}
	if (status !== undefined && status >= 400) {
		return "upstream_4xx";
	}

	if (
		error instanceof TypeError &&
		error.message.toLowerCase().includes("fetch")
	) {
		return "network";
	}

	return "unknown";
}
