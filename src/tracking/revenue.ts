import type { RevenueTrackingApi, TrackInput } from "./@types.js";

/** Enqueue one event and resolve to its id. */
type Emit = (event: TrackInput) => Promise<{ eventId: string }>;

/**
 * Build the flat `track.*` revenue helpers over an `emit` function. Shared
 * by the top-level client and the request-scoped client (which injects meta
 * into `emit`) so both expose the same revenue API (WAN-386).
 *
 * Each helper maps its flat input to a typed first-class revenue event; the
 * remaining tracking context (sessionId / externalUserId / meta) is forwarded
 * as-is. Identity (one of those, or meta-derived) is required by the ingest
 * API — see the warning emitted from the client's `emit`.
 */
export function createRevenueApi(emit: Emit): RevenueTrackingApi {
	const leadQualified: RevenueTrackingApi["leadQualified"] = (input) => {
		const { externalId, email, name, ...context } = input ?? {};
		return emit({
			event: "lead_qualified",
			properties: { externalId, email, name },
			...context,
		});
	};
	return {
		priceShown: ({ amount, currency, itemId, label, ...context }) =>
			emit({
				event: "price_shown",
				properties: { amount, currency, itemId, label },
				...context,
			}),
		pricesCompared: ({ options, ...context }) =>
			emit({ event: "prices_compared", properties: { options }, ...context }),
		optionSelected: ({ id, amount, currency, ...context }) =>
			emit({
				event: "option_selected",
				properties: { id, amount, currency },
				...context,
			}),
		leadQualified,
		lead: leadQualified,
		converted: ({ amount, currency, occurredAt, ...context }) =>
			emit({
				event: "converted",
				properties: { amount, currency, occurredAt },
				...context,
			}),
	};
}
