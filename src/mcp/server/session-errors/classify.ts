import { z } from "zod";
import type { ErrorCauseType } from "../../../tracking/@types.js";

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

const NETWORK_ERROR_MESSAGES = [
	"fetch failed",
	"failed to fetch",
	"networkerror when attempting to fetch",
];

export function classifyCause({ error }: { error: unknown }): ErrorCauseType {
	// zod is an optional peer dep; a nested copy fails instanceof across realms.
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
