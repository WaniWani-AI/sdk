// Geo — Extract location metadata from platform request headers

/**
 * Server-side geolocation extracted from platform headers (Vercel, Cloudflare).
 * All fields are optional — in local dev, no headers are present.
 */
export interface GeoLocation {
	city?: string;
	country?: string;
	countryRegion?: string;
	latitude?: string;
	longitude?: string;
	timezone?: string;
	ip?: string;
}

/**
 * Extracts geolocation from server-side request headers.
 *
 * Supports Vercel (`x-vercel-ip-*`), Cloudflare (`cf-ip*`, `cf-connecting-ip`),
 * and generic IP headers (`x-real-ip`, `x-forwarded-for`).
 *
 * Returns a `GeoLocation` with all fields optional (empty object in local dev).
 */
export function extractGeoFromHeaders(request: Request): GeoLocation {
	const h = request.headers;

	// Vercel URL-encodes city names (e.g. "S%C3%A3o%20Paulo")
	const rawCity = h.get("x-vercel-ip-city") ?? h.get("cf-ipcity") ?? undefined;
	const city = rawCity ? safeDecodeURI(rawCity) : undefined;

	const country =
		h.get("x-vercel-ip-country") ?? h.get("cf-ipcountry") ?? undefined;
	const countryRegion = h.get("x-vercel-ip-country-region") ?? undefined;
	const latitude =
		h.get("x-vercel-ip-latitude") ?? h.get("cf-iplatitude") ?? undefined;
	const longitude =
		h.get("x-vercel-ip-longitude") ?? h.get("cf-iplongitude") ?? undefined;
	const timezone =
		h.get("x-vercel-ip-timezone") ?? h.get("cf-iptimezone") ?? undefined;
	const ip =
		h.get("x-real-ip") ??
		h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
		h.get("cf-connecting-ip") ??
		undefined;

	return { city, country, countryRegion, latitude, longitude, timezone, ip };
}

function safeDecodeURI(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}
