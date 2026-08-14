import type {
	ErrorCauseType,
	SessionErrorCodeType,
	SessionErrorProperties,
} from "../../../tracking/@types.js";
import type { ScopedWaniWaniClient } from "../scoped-client.js";

/** Fire-and-forget: never throws, so a failing caller keeps its own error. */
export function reportSessionError({
	waniwani,
	code,
	cause,
	properties,
}: {
	waniwani?: ScopedWaniWaniClient;
	code: SessionErrorCodeType;
	cause: ErrorCauseType;
	properties?: Omit<SessionErrorProperties, "code" | "cause">;
}): void {
	// Hosts patch console; a logger that throws must not cost us the event either.
	try {
		console.error(
			`[waniwani][session-error] ${code}:${properties?.tool ?? "-"}:${cause}`,
			{ node: properties?.node },
		);
	} catch {}

	if (!waniwani) {
		return;
	}

	// track() is a public interface: it can throw synchronously or return a non-promise.
	try {
		void Promise.resolve(
			waniwani.track({
				event: "session.error",
				properties: { code, cause, ...properties },
			}),
		).catch(() => {});
	} catch {}
}
