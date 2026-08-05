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

/**
 * Runtime fetch-failure strings from the environments that surface network
 * errors as a `TypeError`: undici/Node, Chrome, Firefox. Anchored to these
 * exact phrases rather than a bare "fetch" substring, which also matches
 * unrelated identifiers such as `fetchedPlans`.
 */
const NETWORK_ERROR_MESSAGES = [
	"fetch failed",
	"failed to fetch",
	"networkerror when attempting to fetch",
];

export function classifyCause({
	error,
}: {
	error: unknown;
}): SessionErrorProperties["cause"] {
	// Name-based rather than `instanceof z.ZodError`: zod is an optional peer
	// dependency, and an error thrown by a nested dependency's own zod copy
	// fails an `instanceof` check across that realm boundary.
	if (error instanceof Error && error.name === "ZodError") {
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
		NETWORK_ERROR_MESSAGES.some((message) =>
			error.message.toLowerCase().includes(message),
		)
	) {
		return "network";
	}

	return "unknown";
}
