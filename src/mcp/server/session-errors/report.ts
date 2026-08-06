import type { SessionErrorProperties } from "../../../tracking/@types.js";
import type { ScopedWaniWaniClient } from "../scoped-client.js";

/**
 * The grouping tuple as a single token.
 *
 * It holds the log line's text stable across every occurrence of the same
 * failure, so a host searching or aggregating its own logs matches one string
 * instead of one variant per call. Volatile identifiers stay out of it.
 */
function sessionErrorToken({
	code,
	tool,
	cause,
}: {
	code: SessionErrorProperties["code"];
	tool?: string;
	cause: SessionErrorProperties["cause"];
}): string {
	return `${code}:${tool ?? "-"}:${cause}`;
}

/** Fire-and-forget: the caller is already on a failure path, so a telemetry problem must never replace it. Logged even without a client. */
export function reportSessionError({
	waniwani,
	code,
	cause,
	tool,
	node,
}: {
	waniwani?: ScopedWaniWaniClient;
	code: SessionErrorProperties["code"];
	cause: SessionErrorProperties["cause"];
	tool?: string;
	node?: string;
}): void {
	console.error(
		`[waniwani][session-error] ${sessionErrorToken({ code, tool, cause })}`,
		{
			node,
		},
	);

	if (!waniwani) {
		return;
	}

	// Promise.resolve normalizes a non-promise return; try/catch absorbs a
	// synchronous throw, so track() can never propagate to the caller.
	try {
		void Promise.resolve(
			waniwani.track({
				event: "session.error",
				properties: {
					code,
					cause,
					...(tool ? { tool } : {}),
					...(node ? { node } : {}),
				},
			}),
		).catch(() => {});
	} catch {}
}
