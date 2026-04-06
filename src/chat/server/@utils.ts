// Shared helpers for chat server handlers

export type CorsFunction = (response: Response, request?: Request) => Response;

export function createCors(allowedOrigins: string[]): CorsFunction {
	const originSet = new Set(
		allowedOrigins.map((o) => o.replace(/\/$/, "").toLowerCase()),
	);

	return function applyCors(response: Response, request?: Request): Response {
		const requestOrigin = request?.headers.get("origin");
		const origin = requestOrigin?.toLowerCase();
		const allowed =
			origin && originSet.has(origin) ? (requestOrigin ?? "") : "";
		response.headers.set("Access-Control-Allow-Origin", allowed);
		response.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
		response.headers.set(
			"Access-Control-Allow-Headers",
			"Content-Type, Authorization, X-Session-Id, X-Client-User-Agent",
		);
		response.headers.set("Access-Control-Expose-Headers", "X-Session-Id");
		response.headers.set("Vary", "Origin");
		return response;
	};
}

export function createJsonResponse(cors: CorsFunction) {
	return function json(
		data: object,
		status: number,
		request?: Request,
	): Response {
		return cors(
			new Response(JSON.stringify(data), {
				headers: { "Content-Type": "application/json" },
				status,
			}),
			request,
		);
	};
}
