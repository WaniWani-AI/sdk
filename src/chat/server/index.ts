// Chat Server Module
//
// This entry point is preserved as a re-export shim for back-compat. The
// underlying implementation has moved to `src/legacy/chat/server/`; new code
// should depend on `@waniwani/sdk/legacy/chat/server` or, preferably, replace
// the chat-server catch-all with the direct-to-backend chat widget.

export { WaniWaniError } from "../../error";
export type {
	ApiHandler,
	ApiHandlerOptions,
	BeforeRequestContext,
	BeforeRequestResult,
	ClientVisitorContext,
	VisitorMeta,
	WebSearchConfig,
} from "../../legacy/chat/server/@types";
export type { GeoLocation } from "../../legacy/chat/server/geo";
export { extractGeoFromHeaders } from "../../legacy/chat/server/geo";
