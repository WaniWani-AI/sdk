import type { SessionErrorProperties } from "../../../tracking/@types.js";
import type { ScopedWaniWaniClient } from "../scoped-client.js";

/**
 * The shared identifier for one issue. The platform derives the same token from
 * the event's grouping tuple, so a log line in the host's deployment and an
 * alert on the platform name the same thing.
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

/**
 * Emit one `session.error` without ever affecting the caller.
 *
 * Fire-and-forget by design: the caller is already on a failure path, and a
 * telemetry problem must not replace the failure the host is about to handle.
 * The scoped client carries the request meta, so the event inherits its session
 * id and its source.
 *
 * The log line carries only the token and the node, keeping it stable enough to
 * fold in whatever log aggregator the host runs. It is emitted even without a
 * client, since a flow failing with no telemetry configured is exactly the case
 * where a log line is the only signal there is.
 */
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

	// A caller-supplied ScopedWaniWaniClient is not guaranteed to return a
	// promise from `track` or to only fail asynchronously. `Promise.resolve`
	// normalizes a non-promise return, and the `try/catch` absorbs a synchronous
	// throw, keeping this call from ever propagating into the caller, who is
	// already on a failure path.
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
