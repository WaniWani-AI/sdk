import type { SessionErrorProperties } from "../../../tracking/@types.js";
import type { ScopedWaniWaniClient } from "../scoped-client.js";

/** Matches the token the platform derives from the same grouping tuple, so a host log line and a platform alert name the same issue. */
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
